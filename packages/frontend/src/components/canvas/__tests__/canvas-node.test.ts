import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INode } from '@nomops/workflow';
import CanvasNode from '../CanvasNode.vue';

/**
 * CanvasNode 悬停工具条（对标 n8n canvas-node-toolbar）。
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
