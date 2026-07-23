import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CredentialExpressionField from '../CredentialExpressionField.vue';

/**
 * backlog #33：凭证专属表达式控件 —— 只补全 $secrets，明确标注无 item 上下文。
 */
const make = (props: Partial<InstanceType<typeof CredentialExpressionField>['$props']> = {}) =>
  mount(CredentialExpressionField, {
    props: {
      modelValue: '',
      type: 'password',
      fieldId: 'fld-apiKey',
      secrets: ['OPENAI_KEY', 'STRIPE_KEY', 'GITHUB_TOKEN'],
      secretsEnabled: true,
      ...props,
    },
  });

describe('CredentialExpressionField（凭证专属表达式，#33）', () => {
  it('固定模式：password 型输入被遮罩，无作用域提示', () => {
    const w = make();
    expect(w.find('input').attributes('type')).toBe('password');
    expect(w.find('[data-test="cred-expr-scope"]').exists()).toBe(false);
  });

  it('切到表达式模式：明示只有 $secrets、无 $json 上下文', async () => {
    const w = make();
    await w.find('[data-test="cred-expr-toggle"]').trigger('click');
    const scope = w.find('[data-test="cred-expr-scope"]');
    expect(scope.exists()).toBe(true);
    expect(scope.text()).toContain('$secrets.KEY');
    expect(scope.text()).toContain('$json');
    // 表达式模式下即便是 password 字段也明文展示引用（引用非机密）
    expect(w.find('input').attributes('type')).toBe('text');
  });

  it('已含 $secrets 表达式的值 → 初始即表达式模式', () => {
    const w = make({ modelValue: '{{ $secrets.OPENAI_KEY }}' });
    expect(w.find('[data-test="cred-expr-scope"]').exists()).toBe(true);
  });

  it('聚焦补全：点密钥 chip 插入 {{ $secrets.KEY }}', async () => {
    const w = make({ modelValue: '' });
    await w.find('[data-test="cred-expr-toggle"]').trigger('click');
    await w.find('input').trigger('focus');
    const keys = w.findAll('[data-test="cred-expr-key"]');
    expect(keys.length).toBe(3);
    await keys[0]!.trigger('mousedown');
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['{{ $secrets.OPENAI_KEY }}']);
  });

  it('补全过滤：按 $secrets. 后片段筛选', async () => {
    const w = make({ modelValue: '{{ $secrets.STRIP' });
    await w.find('input').trigger('focus');
    const keys = w.findAll('[data-test="cred-expr-key"]');
    expect(keys.map((k) => k.text())).toEqual(['$secrets.STRIPE_KEY']);
    // 插入替换掉未闭合片段，不重复
    await keys[0]!.trigger('mousedown');
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['{{ $secrets.STRIPE_KEY }}']);
  });

  it('externalSecrets 未启用：提示引用需配置 provider 才解析', async () => {
    const w = make({ secretsEnabled: false, secrets: [] });
    await w.find('[data-test="cred-expr-toggle"]').trigger('click');
    expect(w.find('[data-test="cred-expr-disabled"]').exists()).toBe(true);
  });
});
