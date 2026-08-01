import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/views/DataTableView.vue'), 'utf8');

describe('DataTableView UI 契约', () => {
  it('重命名使用产品内弹窗，危险操作使用产品内确认', () => {
    expect(source).toContain("import UiDialog from '../components/ui/UiDialog.vue'");
    expect(source).toContain('test-id="rename-data-table"');
    expect(source).toContain('ui.requestConfirm({');
    expect(source).not.toContain('window.prompt(');
    expect(source).not.toContain('window.confirm(');
  });

  it('加载、错误、空表和搜索无结果具有独立状态', () => {
    expect(source).toContain('title="Loading data table"');
    expect(source).toContain('title="Could not load data table"');
    expect(source).toContain('This table has no rows yet');
    expect(source).toContain('No rows match your search');
    expect(source).toContain('data-test="dtv-clear-search"');
  });

  it('列、行和表操作均提供结果反馈', () => {
    for (const title of ['Column added', 'Column deleted', 'Row added', 'Row deleted', 'Data table renamed']) {
      expect(source).toContain(`title: '${title}'`);
    }
  });
});
