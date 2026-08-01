import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INode } from '@nomops/workflow';
import { useNodeTypesStore } from '../../../stores/node-types.js';
import CanvasNode from '../CanvasNode.vue';

/**
 * CanvasNode 悬停工具条（对标基线 canvas-node-toolbar）。
 * 便签分支不含 <Handle>（无端口），可独立挂载；普通节点分支的 Handle 需 VueFlow 上下文，用 stub 顶掉。
 */
const stickyNode: INode = {
  id: 's1',
  name: 'Sticky Note',
  type: 'nomops.stickyNote',
  typeVersion: 1,
  position: [0, 0],
  parameters: { color: 'yellow', content: 'hi' },
};

const plainNode: INode = {
  id: 'n1',
  name: 'HTTP Request',
  type: 'nomops.httpRequest',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

const triggerNode: INode = {
  id: 't1',
  name: 'Manual Trigger',
  type: 'nomops.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

const mountNode = (node: INode) =>
  mount(CanvasNode, {
    props: { data: { node } },
    global: { stubs: { Handle: true, IconSvg: true } },
  });

describe('CanvasNode 悬停工具条', () => {
  beforeEach(() => setActivePinia(createPinia()));

  // 回归：曾因 watch getter 引用其后声明的 stickyColorOpen 命中 TDZ，setup 抛错 → 节点整个不渲染。
  it('便签能挂载渲染，工具条 = Delete / Change color / More actions（无执行/无禁用）', () => {
    const w = mountNode(stickyNode);
    expect(w.find('.sticky-note').exists()).toBe(true);
    const titles = w.findAll('.tb-btn').map((b) => b.attributes('title'));
    expect(titles).toEqual(['Delete', 'Change color', 'More actions']);
  });

  it('普通节点工具条 = Execute step / Deactivate / Delete / More actions（4 键）', () => {
    const w = mountNode(plainNode);
    const titles = w.findAll('.tb-btn').map((b) => b.attributes('title'));
    expect(titles).toEqual(['Execute step', 'Deactivate', 'Delete', 'More actions']);
  });

  it('普通节点使用 48px 图标、16px 主端口，并保留外置名称', () => {
    const w = mountNode(plainNode);
    expect(w.findComponent({ name: 'IconSvg' }).attributes('size')).toBe('48');
    expect(w.findAll('.main-handle')).toHaveLength(2);
    expect(w.find('.node-label').text()).toBe('HTTP Request');
  });

  it('无输入节点使用触发器轮廓，选中态落在节点本体', () => {
    useNodeTypesStore().descriptions = [{ type: triggerNode.type, inputs: [], outputs: ['main'] }] as never;
    const w = mount(CanvasNode, {
      props: { data: { node: triggerNode }, selected: true },
      global: { stubs: { Handle: true, IconSvg: true } },
    });
    expect(w.find('.nomops-node').classes()).toEqual(expect.arrayContaining(['trigger', 'selected']));
  });

  it('执行详情的 ok 状态归一为 success，并显示成功徽标', () => {
    const w = mount(CanvasNode, {
      props: { data: { node: plainNode }, readonly: true, runStatus: 'ok' },
      global: { stubs: { Handle: true, IconSvg: true } },
    });
    expect(w.find('.nomops-node').classes()).toContain('status-success');
    expect(w.find('[data-test="node-run-status"]').attributes('aria-label')).toBe('Node finished successfully');
    expect(w.find('.run-success').exists()).toBe(true);
  });

  it('错误状态显示明确徽标，disabled 快照复用节点禁用视觉', () => {
    const failed = mount(CanvasNode, {
      props: { data: { node: plainNode }, readonly: true, runStatus: 'error' },
      global: { stubs: { Handle: true, IconSvg: true } },
    });
    expect(failed.find('.run-error').attributes('aria-label')).toBe('Node execution failed');

    const disabled = mount(CanvasNode, {
      props: { data: { node: plainNode }, readonly: true, runStatus: 'disabled' },
      global: { stubs: { Handle: true, IconSvg: true } },
    });
    expect(disabled.find('.nomops-node').classes()).toContain('disabled');
    expect(disabled.find('.node-label').text()).toContain('(Deactivated)');
  });

  it('节点工具条与快捷新增的图标按钮都有可访问名称', () => {
    const w = mountNode(plainNode);
    expect(w.findAll('.tb-btn').map((button) => button.attributes('aria-label'))).toEqual([
      'Execute step',
      'Deactivate',
      'Delete',
      'More actions',
    ]);
    expect(w.find('.port-plus').attributes('aria-label')).toBe('Add node');
  });

  // 回归：色板/菜单曾用 @mouseleave 关，因工具条 pointer-events:none 鼠标穿透到画布触发 mouseleave，
  // 没点到就自关。改为点击外部才关后，mouseleave 不应关闭已打开的色板。
  it('色板打开后，节点 mouseleave 不再误关（改点击外部才关）', async () => {
    const w = mountNode(stickyNode);
    await w.find('[data-test-node-tb="sticky-color"]').trigger('click');
    expect(w.find('.sticky-swatches').exists()).toBe(true);

    await w.find('.sticky-note').trigger('mouseleave');
    expect(w.find('.sticky-swatches').exists()).toBe(true); // 仍开
  });

  it('点色板内某色 → 关闭色板（选色即收起）', async () => {
    const w = mountNode(stickyNode);
    await w.find('[data-test-node-tb="sticky-color"]').trigger('click');
    await w.find('.sticky-swatches .sw-blue').trigger('click');
    expect(w.find('.sticky-swatches').exists()).toBe(false);
  });
});
