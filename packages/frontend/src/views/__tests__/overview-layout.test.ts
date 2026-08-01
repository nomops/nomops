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

  it('资源操作统一使用产品内弹窗，不调用浏览器原生确认框', () => {
    expect(source).toContain("import UiDialog from '../components/ui/UiDialog.vue'");
    expect(source).toContain('ui.requestConfirm({');
    expect(source).not.toContain('window.confirm(');
    expect(source).not.toContain('class="modal-mask"');

    for (const id of ['folder-modal', 'data-table-modal', 'manage-tags-modal', 'move-modal', 'share-modal']) {
      expect(source).toContain(`test-id="${id}"`);
    }
  });

  it('工作流资源操作提供完成反馈', () => {
    for (const title of ['Workflow moved', 'Workflow duplicated', 'Workflow archived', 'Tags updated']) {
      expect(source).toContain(`title: t('${title}')`);
    }
  });
});
