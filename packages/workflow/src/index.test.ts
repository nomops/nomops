import { describe, expect, it } from 'vitest';
import { WORKFLOW_PACKAGE } from './index.js';

describe('@nomops/workflow 占位', () => {
  it('导出包标识常量', () => {
    expect(WORKFLOW_PACKAGE).toBe('@nomops/workflow');
  });
});
