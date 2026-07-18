import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { INodeProperties } from '@nomops/workflow';
import ParamInput from '../ParamInput.vue';

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

  it('string 点 fx 切换表达式模式（加 = 前缀）', async () => {
    const w = make({ type: 'string' }, 'hello');
    await w.find('button.fx').trigger('click');
    expect(w.emitted('change')![0]).toEqual(['=hello']);
  });

  it('值以 = 开头时渲染 ExpressionInput', () => {
    const w = make({ type: 'string' }, '={{ $json.x }}');
    expect(w.find('[data-test="expression-input"]').exists()).toBe(true);
  });

  it('noDataExpression 的 string 不显示 fx 按钮', () => {
    const w = make({ type: 'string', noDataExpression: true }, 'code');
    expect(w.find('button.fx').exists()).toBe(false);
  });

  it('number → number 输入，emits 数值', async () => {
    const w = make({ type: 'number', default: 0 }, 5);
    await w.find('input[type="number"]').setValue('42');
    expect(w.emitted('change')![0]).toEqual([42]);
  });

  it('boolean → n8n 式开关(role=switch)', async () => {
    const w = make({ type: 'boolean', default: false }, false);
    await w.find('[role="switch"]').trigger('click');
    expect(w.emitted('change')![0]).toEqual([true]);
  });

  it('options → select 渲染全部选项', () => {
    const w = make(
      {
        type: 'options',
        default: 'a',
        options: [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b' },
        ],
      },
      'a',
    );
    expect(w.findAll('option')).toHaveLength(2);
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
