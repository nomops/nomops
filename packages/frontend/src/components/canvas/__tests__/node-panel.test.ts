import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INode, INodeTypeDescription, NodeCategory } from '@nomops/workflow';
import type { NodeTypeInfo } from '../../../api/client.js';
import { api } from '../../../api/client.js';
import { useEditorStore } from '../../../stores/editor.js';
import { useNodeTypesStore } from '../../../stores/node-types.js';
import NodePanel from '../NodePanel.vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/canvas/NodePanel.vue'), 'utf8');
const storeSource = readFileSync(resolve(process.cwd(), 'src/stores/node-types.ts'), 'utf8');

const nodeType = (
  name: string,
  displayName: string,
  categories: NodeCategory[],
  extra: Partial<INodeTypeDescription> = {},
): NodeTypeInfo => ({
  type: `nomops.${name}`,
  displayName,
  name,
  group: ['transform'],
  categories,
  version: 1,
  description: `${displayName} description`,
  defaults: { name: displayName },
  inputs: ['main'],
  outputs: ['main'],
  properties: [],
  ...extra,
});

const triggerNode: INode = {
  id: 'trigger-1',
  name: 'Manual Trigger',
  type: 'nomops.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

describe('NodePanel 元数据驱动分类', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const editor = useEditorStore();
    editor.nodes = [triggerNode];
    editor.nodePickerOpen = true;
  });

  afterEach(() => vi.restoreAllMocks());

  it('新节点只凭 categories 自动进入正确分类，不依赖 type/name 清单', async () => {
    const nodeTypes = useNodeTypesStore();
    nodeTypes.descriptions = [
      nodeType('brandNewTransform', 'Brand New Transform', ['dataTransformation']),
      nodeType('brandNewFlow', 'Brand New Flow', ['flow']),
    ];
    const wrapper = mount(NodePanel, { global: { stubs: { IconSvg: true } } });

    await wrapper.find('[data-test-category="transform"]').trigger('click');

    expect(wrapper.find('[data-test-add-node="brandNewTransform"]').exists()).toBe(true);
    expect(wrapper.find('[data-test-add-node="brandNewFlow"]').exists()).toBe(false);
  });

  it('搜索读取 aliases，并排除 description.hidden 节点', async () => {
    const nodeTypes = useNodeTypesStore();
    nodeTypes.descriptions = [
      nodeType('reshape', 'Reshape Data', ['dataTransformation'], { aliases: ['normalize'] }),
      nodeType('internalOnly', 'Internal Only', ['core'], { aliases: ['secret-node'], hidden: true }),
    ];
    const wrapper = mount(NodePanel, { global: { stubs: { IconSvg: true } } });

    await wrapper.find('[data-test="node-search"]').setValue('normalize');
    expect(wrapper.find('[data-test-add-node="reshape"]').exists()).toBe(true);

    await wrapper.find('[data-test="node-search"]').setValue('secret-node');
    expect(wrapper.find('[data-test-add-node="internalOnly"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('No matching nodes');
  });

  it('区分节点目录加载、失败、重试和实例无节点状态', () => {
    expect(source).toContain('title="Loading nodes"');
    expect(source).toContain('title="Could not load nodes"');
    expect(source).toContain('@click="retryTypes"');
    expect(source).toContain('title="No nodes available"');
    expect(storeSource).toContain("error: ''");
    expect(storeSource).toContain('async fetch(force = false)');
  });

  it('支持 Escape 关闭并把焦点还给打开入口', () => {
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('previouslyFocused?.focus()');
    expect(source).toContain("window.addEventListener('keydown', onWindowKeydown)");
    expect(source).toContain("window.removeEventListener('keydown', onWindowKeydown)");
  });

  it('支持方向键循环浏览节点与分类', () => {
    expect(source).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']");
    expect(source).toContain("(current + 1 + items.length) % items.length");
    expect(source).toContain("(current - 1 + items.length) % items.length");
    expect(source).toContain('@keydown="onListKeydown"');
  });

  it('提供命名面板、搜索框与搜索无结果恢复入口', () => {
    expect(source).toContain('role="complementary" aria-labelledby="node-picker-title"');
    expect(source).toContain('aria-label="Search nodes"');
    expect(source).toContain('title="No matching nodes"');
    expect(source).toContain("@click=\"search = ''\"");
  });

  it('节点目录请求失败时记录错误而不向画布抛出', async () => {
    vi.spyOn(api, 'nodeTypes').mockRejectedValueOnce(new Error('catalog offline'));
    const nodeTypes = useNodeTypesStore();

    await expect(nodeTypes.fetch()).resolves.toBeUndefined();
    expect(nodeTypes.loading).toBe(false);
    expect(nodeTypes.loaded).toBe(false);
    expect(nodeTypes.error).toBe('catalog offline');
  });

  it('Retry 成功后清除目录错误并标记加载完成', async () => {
    const catalog = [nodeType('retryNode', 'Retry Node', ['core'])];
    vi.spyOn(api, 'nodeTypes')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(catalog);
    const nodeTypes = useNodeTypesStore();

    await nodeTypes.fetch();
    await nodeTypes.fetch(true);

    expect(nodeTypes.error).toBe('');
    expect(nodeTypes.loaded).toBe(true);
    expect(nodeTypes.descriptions).toEqual(catalog);
  });
});
