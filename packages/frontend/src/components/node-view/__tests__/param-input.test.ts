import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { INodeProperties } from '@nomops/workflow';
import ParamInput from '../ParamInput.vue';

// ParamInput 引 editor store（panel-right → Focus Panel 联动），挂测试 pinia
beforeEach(() => setActivePinia(createPinia()));

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
});
