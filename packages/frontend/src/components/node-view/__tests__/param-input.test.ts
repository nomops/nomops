import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INodeProperties } from '@nomops/workflow';
import ParamInput from '../ParamInput.vue';
import { api } from '../../../api/client.js';

// ParamInput 引 editor store（panel-right → Focus Panel 联动），挂测试 pinia
beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

const make = (prop: Partial<INodeProperties>, value: unknown = undefined) =>
  mount(ParamInput, {
    props: {
      prop: {
        displayName: 'Test',
        name: 'test',
        type: 'string',
        default: '',
        ...prop,
      } as INodeProperties,
      value,
    },
  });

describe('ParamInput（schema 驱动控件分发）', () => {
  it('string → 文本框，输入触发 change', async () => {
    const w = make({ type: 'string' }, 'abc');
    const input = w.find('input');
    expect(input.exists()).toBe(true);
    await input.setValue('xyz');
    expect(w.emitted('change')![0]).toEqual(['xyz']);
  });

  it('string 点 Expression 分段切换表达式模式（加 = 前缀）', async () => {
    const w = make({ type: 'string' }, 'hello');
    // D110：Fixed|Expression 分段控件，第二个按钮是 Expression
    await w.findAll('.pt-seg-btn')[1]!.trigger('click');
    expect(w.emitted('change')![0]).toEqual(['=hello']);
  });

  it('值以 = 开头时渲染 ExpressionInput', () => {
    const w = make({ type: 'string' }, '={{ $json.x }}');
    expect(w.find('[data-test="expression-input"]').exists()).toBe(true);
  });

  it('noDataExpression 的 string 不显示 Fixed|Expression 分段', () => {
    const w = make({ type: 'string', noDataExpression: true }, 'code');
    expect(w.find('.pt-seg').exists()).toBe(false);
  });

  it('number → number 输入，emits 数值', async () => {
    const w = make({ type: 'number', default: 0 }, 5);
    await w.find('input[type="number"]').setValue('42');
    expect(w.emitted('change')![0]).toEqual([42]);
  });

  it('boolean → 基线式开关(role=switch)', async () => {
    const w = make({ type: 'boolean', default: false }, false);
    await w.find('[role="switch"]').trigger('click');
    expect(w.emitted('change')![0]).toEqual([true]);
  });

  it('options → 自定义下拉(D114):展开列全部选项,点击选中并关闭', async () => {
    const w = make(
      {
        type: 'options',
        default: 'a',
        options: [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b', description: 'the b option' },
        ],
      },
      'a',
    );
    expect(w.find('[data-test="options-toggle"]').text()).toContain('A');
    await w.find('[data-test="options-toggle"]').trigger('click');
    const items = w.findAll('.opt-dd-item');
    expect(items).toHaveLength(2);
    expect(items[1]!.text()).toContain('the b option'); // 描述副行
    await items[1]!.trigger('click');
    expect(w.emitted('change')![0]).toEqual(['b']);
    expect(w.find('[data-test="options-pop"]').exists()).toBe(false); // 选后关闭
  });

  it('panel-right:有 nodeName 才显示,点击钉进 Focus Panel', async () => {
    const w = mount(ParamInput, {
      props: {
        prop: { displayName: 'T', name: 'p1', type: 'string', default: '' } as INodeProperties,
        value: 'x',
        nodeName: 'Node A',
      },
    });
    const btn = w.find('[data-test="param-focus"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    const { useEditorStore } = await import('../../../stores/editor.js');
    const editor = useEditorStore();
    expect(editor.pinnedParams).toEqual([{ nodeName: 'Node A', paramName: 'p1' }]);
    expect(editor.focusPanelOpen).toBe(true);
    // 无 nodeName(Focus 面板自身上下文)不显示
    const w2 = make({ type: 'string' }, 'x');
    expect(w2.find('[data-test="param-focus"]').exists()).toBe(false);
  });

  it('json → textarea，合法 JSON 失焦提交、非法给错误', async () => {
    const w = make({ type: 'json', default: {} }, { a: 1 });
    const ta = w.find('textarea');
    await ta.setValue('{"b": 2}');
    await ta.trigger('blur');
    expect(w.emitted('change')![0]).toEqual([{ b: 2 }]);

    await ta.setValue('{broken');
    await ta.trigger('blur');
    expect(w.text()).toContain('Invalid JSON');
  });

  it('notice → 只渲染说明文本', () => {
    const w = make({ type: 'notice', description: '注意事项' });
    expect(w.text()).toContain('注意事项');
    expect(w.find('input').exists()).toBe(false);
  });

  it('From AI 芯片（#19 D096）:仅 aiTool 且可切表达式的字段显示,点击插入 $fromAI 模板', async () => {
    const w = mount(ParamInput, {
      props: { prop: { displayName: 'Order Id', name: 'orderId', type: 'string', default: '' } as INodeProperties, value: '', aiTool: true },
    });
    const chip = w.find('[data-test="param-from-ai"]');
    expect(chip.exists()).toBe(true);
    await chip.trigger('click');
    const emitted = w.emitted('change')![0]![0] as string;
    expect(emitted).toContain('$fromAI(');
    expect(emitted).toContain("'orderId'");
    expect(emitted.startsWith('=')).toBe(true);

    // 非 aiTool → 不显示
    const w2 = make({ type: 'string' }, '');
    expect(w2.find('[data-test="param-from-ai"]').exists()).toBe(false);
    // aiTool 但不可切表达式（noDataExpression）→ 不显示
    const w3 = mount(ParamInput, {
      props: { prop: { displayName: 'X', name: 'x', type: 'string', default: '', noDataExpression: true } as INodeProperties, value: '', aiTool: true },
    });
    expect(w3.find('[data-test="param-from-ai"]').exists()).toBe(false);
  });

  it('动态 options 按凭证和依赖参数加载并在依赖变化后刷新', async () => {
    const load = vi.spyOn(api.dynamicNodeParameters, 'options')
      .mockResolvedValueOnce([{ name: 'Engineering', value: 'C1' }])
      .mockResolvedValueOnce([{ name: 'Sales', value: 'C2' }]);
    const w = mount(ParamInput, {
      props: {
        prop: {
          displayName: 'Channel', name: 'channel', type: 'options', default: '',
          typeOptions: { loadOptionsMethod: 'channels', loadOptionsDependsOn: ['region'] },
        } as INodeProperties,
        value: '',
        nodeType: 'nomops.resourceDemo',
        nodeTypeVersion: 1,
        nodeParameters: { region: 'eu' },
        credentials: { resourceApi: { id: 'cred-1', name: 'Resource API' } },
      },
    });
    await flushPromises();
    await w.find('[data-test="options-toggle"]').trigger('click');
    expect(w.text()).toContain('Engineering');
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      nodeType: 'nomops.resourceDemo',
      currentNodeParameters: { region: 'eu' },
      credentials: { resourceApi: { id: 'cred-1' } },
    }));

    await w.setProps({ nodeParameters: { region: 'us' } });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fixedCollection 按元数据添加、编辑和排序重复行', async () => {
    const w = make({
      type: 'fixedCollection',
      default: { headers: [] },
      typeOptions: { multipleValues: true, sortable: true, fixedCollection: { itemTitle: 'Header', layout: 'horizontal' } },
      options: [{
        name: 'headers', value: 'headers',
        values: [
          { displayName: 'Name', name: 'name', type: 'string', default: '' },
          { displayName: 'Value', name: 'value', type: 'string', default: '' },
        ],
      }],
    }, { headers: [] });
    await w.find('[data-test-add-fixed="headers"]').trigger('click');
    expect(w.emitted('change')![0]).toEqual([{ headers: [{ name: '', value: '' }] }]);

    await w.setProps({ value: { headers: [{ name: 'x-api-key', value: '' }] } });
    const inputs = w.findAll('.fixed-row input');
    await inputs[1]!.setValue('secret-ref');
    expect(w.emitted('change')!.at(-1)).toEqual([{ headers: [{ name: 'x-api-key', value: 'secret-ref' }] }]);
  });

  it('resourceLocator 可切 list、URL、ID 三模式并搜索资源', async () => {
    vi.spyOn(api.dynamicNodeParameters, 'resourceLocatorResults').mockResolvedValue({
      results: [{ name: 'Product', value: 'C2' }],
    });
    const w = mount(ParamInput, {
      props: {
        prop: {
          displayName: 'Target', name: 'target', type: 'resourceLocator', default: { mode: 'list', value: '' },
          modes: [
            { displayName: 'From list', name: 'list', searchListMethod: 'searchChannels' },
            { displayName: 'By URL', name: 'url' },
            { displayName: 'By ID', name: 'id' },
          ],
        } as INodeProperties,
        value: { mode: 'list', value: '' },
        nodeType: 'nomops.resourceDemo',
        nodeParameters: {},
        credentials: { resourceApi: { id: 'cred-1', name: 'Resource API' } },
      },
    });
    await flushPromises();
    expect(w.find('[data-test="locator-list"]').text()).toContain('Product');

    await w.find('[data-test-locator-mode="url"]').trigger('click');
    expect(w.emitted('change')!.at(-1)).toEqual([{ mode: 'url', value: '' }]);
    await w.setProps({ value: { mode: 'url', value: '' } });
    expect(w.find('[data-test="locator-url"]').exists()).toBe(true);

    await w.find('[data-test-locator-mode="id"]').trigger('click');
    expect(w.emitted('change')!.at(-1)).toEqual([{ mode: 'id', value: '' }]);
  });
});
