import { describe, expect, it } from 'vitest';
import { integrationDescriptions } from '../integrations/integrations.js';
import { declarative } from '../integrations/declarative.js';

/**
 * 声明式集成节点的结构守卫：描述是纯数据，跑不起来的错误要在这里拦住——
 * 每个 operation 选项必须有 routing；凭证注入必须引用已声明凭证；
 * routing 表达式里的 $parameter.x 必须是真实存在的参数。
 */

/** 抽取声明值里所有 $parameter.xxx 引用。 */
function parameterRefs(value: unknown, refs: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\$parameter\.([a-zA-Z0-9_]+)/g)) refs.add(m[1]!);
    return;
  }
  if (Array.isArray(value)) for (const v of value) parameterRefs(v, refs);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) parameterRefs(v, refs);
  }
}

describe('声明式集成节点结构守卫', () => {
  it.each(integrationDescriptions.map((d) => [d.name, d] as const))('%s：描述合法', (_name, desc) => {
    // 工厂能产出可加载节点（无 execute）
    const loadable = declarative(desc);
    expect(loadable.type).toBe(`nomops.${desc.name}`);

    const opProp = desc.properties.find((p) => (p.options ?? []).some((o) => o.routing));
    expect(opProp, '必须有带 routing 的 operation 属性').toBeDefined();

    const paramNames = new Set(desc.properties.map((p) => p.name));
    for (const option of opProp!.options ?? []) {
      // 每个 operation 都有 routing 且 url 非空
      expect(option.routing, `操作 ${String(option.value)} 缺 routing`).toBeDefined();
      expect(option.routing!.url.length).toBeGreaterThan(0);
      // 相对 url 必须有 baseUrl 兜底
      if (!/^https?:\/\//.test(option.routing!.url) && !option.routing!.url.startsWith('={{')) {
        expect(desc.requestDefaults?.baseUrl, `操作 ${String(option.value)} 相对 url 但无 baseUrl`).toBeTruthy();
      }
      // routing 里引用的参数必须存在
      const refs = new Set<string>();
      parameterRefs(option.routing, refs);
      for (const ref of refs) {
        expect(paramNames.has(ref), `操作 ${String(option.value)} 引用了不存在的参数 $parameter.${ref}`).toBe(true);
      }
    }

    // 凭证注入必须引用已声明的凭证
    if (desc.credentialInjection) {
      const declared = new Set((desc.credentials ?? []).map((c) => c.name));
      expect(declared.has(desc.credentialInjection.credentialName)).toBe(true);
      expect(['header', 'query']).toContain(desc.credentialInjection.in);
      expect(desc.credentialInjection.template).toMatch(/\{\{\s*\w+\s*\}\}/);
    }

    // displayOptions 引用的参数存在
    for (const prop of desc.properties) {
      for (const dep of Object.keys(prop.displayOptions?.show ?? {})) {
        expect(paramNames.has(dep), `${prop.name} 的 displayOptions 引用了不存在的 ${dep}`).toBe(true);
      }
    }
  });

  it('清单里共 6 个集成节点，且 HackerNews 无需凭证', () => {
    expect(integrationDescriptions).toHaveLength(6);
    const hn = integrationDescriptions.find((d) => d.name === 'hackerNews')!;
    expect(hn.credentials ?? []).toHaveLength(0);
    expect(hn.credentialInjection).toBeUndefined();
  });
});
