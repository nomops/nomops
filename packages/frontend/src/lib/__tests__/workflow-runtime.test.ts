import { describe, expect, it } from 'vitest';
import { resolveParameterValue } from '@nomops/workflow';
import type { IExpressionContext } from '@nomops/workflow';

describe('前端工作流运行时', () => {
  it('画布依赖可加载并执行表达式', () => {
    const context: IExpressionContext = {
      json: { count: 41 },
      itemIndex: 0,
      items: [{ json: { count: 41 } }],
      runData: {},
      workflow: { id: 'workflow-browser', name: 'Browser workflow' },
    };

    expect(resolveParameterValue('={{ $json.count + 1 }}', context)).toBe(42);
  });
});
