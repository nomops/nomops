import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/views/OverviewView.vue'), 'utf8');

describe('Overview 资源 Tab 布局契约', () => {
  it('五个资源 Tab 始终存在', () => {
    for (const id of ['workflows', 'credentials', 'executions', 'variables', 'data-tables']) {
      expect(source).toContain(`data-test="tab-${id}"`);
    }
  });

  it('Tab 容器锁定可见高度，且只裁切纵向溢出', () => {
    const styles = source.match(/\.overview-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(styles).toContain('height: 42px');
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('overflow-y: hidden');
  });
});
