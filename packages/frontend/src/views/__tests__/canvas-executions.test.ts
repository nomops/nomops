import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/views/CanvasView.vue'), 'utf8');

describe('执行详情 UI 契约', () => {
  it('删除执行使用产品内确认并反馈结果', () => {
    expect(source).toContain("title: 'Delete execution?'");
    expect(source).toContain('await ui.requestConfirm({');
    expect(source).toContain("title: 'Execution deleted'");
  });

  it('评分控件使用主题 SVG 与可访问名称', () => {
    expect(source).toContain('aria-label="Rate execution as good"');
    expect(source).toContain('aria-label="Rate execution as bad"');
    expect(source).not.toContain('>👍</button>');
    expect(source).not.toContain('>👎</button>');
  });

  it('执行详情头在窄屏换行并保留操作按钮', () => {
    expect(source).toContain('@media (max-width: 900px)');
    expect(source).toMatch(/\.exec-detail-head \{[\s\S]*?flex-wrap: wrap/);
  });
});
