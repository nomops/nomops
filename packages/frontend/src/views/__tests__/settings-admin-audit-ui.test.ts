import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(resolve(process.cwd(), `src/${path}`), 'utf8');
const settings = src('views/SettingsView.vue');
const admin = src('views/AdminView.vue');
const audit = src('views/AuditView.vue');
const builder = src('views/BuilderView.vue');
const node = src('components/canvas/CanvasNode.vue');
const canvas = src('components/canvas/WorkflowCanvas.vue');
const app = src('App.vue');

describe('settings, admin, and audit UI', () => {
  it('removes browser-native dialogs from settings', () => {
    expect(settings).not.toContain('window.confirm(');
    expect(settings).not.toContain('window.prompt(');
    expect(settings).not.toMatch(/(?<!request)confirm\(/);
    expect(settings).toContain('test-id="mcp-description-dialog"');
  });

  it('confirms high-impact settings actions in the product', () => {
    for (const title of ['Rotate deployment key?', 'Revoke API key?', 'Delete custom role?', 'Remove activation key?', 'Disconnect source control?']) {
      expect(settings).toContain(`title: '${title}'`);
    }
    expect(settings).toContain('ui.requestConfirm({');
  });

  it('gives admin and audit pages recoverable async states', () => {
    expect(admin).toContain('title="Loading admin panel"');
    expect(admin).toContain('title="Could not load admin panel"');
    expect(audit).toContain('title="Loading audit logs"');
    expect(audit).toContain('title="Could not load audit logs"');
    expect(audit).toContain('>Retry</button>');
  });

  it('handles empty management tables and narrow screens', () => {
    expect(admin).toContain('title="No members found"');
    expect(audit).toContain('title="No audit entries yet"');
    expect(admin).toContain('@media (max-width: 600px)');
    expect(audit).toContain('audit-table-wrap');
  });

  it('uses the global product input dialog for both node rename entry points', () => {
    expect(app).toContain('<UiInputHost />');
    expect(node).toContain("ui.requestInput({ title: 'Rename node'");
    expect(canvas).toContain("ui.requestInput({ title: 'Rename node'");
    expect(node).not.toContain('window.prompt(');
    expect(canvas).not.toContain('window.prompt(');
  });

  it('moves the final builder destructive action into product confirmation', () => {
    expect(builder).toContain("title: 'Discard builder session?'");
    expect(builder).not.toContain('window.confirm(');
    expect(builder).toContain("title: 'Builder session discarded'");
  });
});
