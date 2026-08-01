import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/credentials/CredentialModal.vue'), 'utf8');

describe('CredentialModal UI 契约', () => {
  it('复用全局产品弹窗并移除浏览器原生确认框', () => {
    expect(source).toContain("import UiDialog from '../ui/UiDialog.vue'");
    expect(source).toContain('ui.requestConfirm({');
    expect(source).not.toContain('window.confirm(');
    expect(source).not.toContain('class="cred-overlay"');
  });

  it('连接测试呈现加载、成功或失败状态条并支持重试', () => {
    expect(source).toContain('data-test="cred-test-loading"');
    expect(source).toContain('data-test="cred-test-result"');
    expect(source).toContain("Couldn't connect with these settings");
    expect(source).toContain('>Retry</button>');
  });

  it('类型搜索自动聚焦，帮助链接指向真实文档', () => {
    expect(source).toMatch(/data-test="cred-search"[\s\S]*?autofocus/);
    expect(source).toContain(':href="LINKS.docs"');
    expect(source).not.toContain('href="#docs"');
  });
});
