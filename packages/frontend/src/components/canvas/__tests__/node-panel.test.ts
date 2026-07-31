import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INode, INodeTypeDescription, NodeCategory } from '@nomops/workflow';
import type { NodeTypeInfo } from '../../../api/client.js';
import { useEditorStore } from '../../../stores/editor.js';
import { useNodeTypesStore } from '../../../stores/node-types.js';
import NodePanel from '../NodePanel.vue';

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
});
