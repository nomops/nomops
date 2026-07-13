import type { INodeProperties, JsonObject } from '@nomops/workflow';

/**
 * displayOptions 条件显示（docs/02 第三节）：
 * show：所有键都命中才显示；hide：任一键命中就隐藏。
 * 参数未填时取该属性的 default 参与判定。
 */
export function isPropertyVisible(
  prop: INodeProperties,
  params: JsonObject,
  allProps: INodeProperties[],
): boolean {
  const opts = prop.displayOptions;
  if (!opts) return true;

  const valueOf = (key: string): unknown => {
    if (key in params) return params[key];
    return allProps.find((p) => p.name === key)?.default;
  };

  if (opts.show) {
    for (const [key, allowed] of Object.entries(opts.show)) {
      if (!allowed.includes(valueOf(key) as string | number | boolean)) return false;
    }
  }
  if (opts.hide) {
    for (const [key, hidden] of Object.entries(opts.hide)) {
      if (hidden.includes(valueOf(key) as string | number | boolean)) return false;
    }
  }
  return true;
}
