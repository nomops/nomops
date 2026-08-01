import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvas = readFileSync(resolve(process.cwd(), 'src/views/CanvasView.vue'), 'utf8');
const ndv = readFileSync(resolve(process.cwd(), 'src/components/ndv/NdvModal.vue'), 'utf8');
const workflowCanvas = readFileSync(resolve(process.cwd(), 'src/components/canvas/WorkflowCanvas.vue'), 'utf8');

describe('canvas editor UI', () => {
  it('uses accessible product dialogs for workflow metadata and URL imports', () => {
    expect(canvas).toContain("import UiDialog from '../components/ui/UiDialog.vue'");
    for (const id of ['desc-modal', 'import-url-dialog', 'wf-settings-modal']) {
      expect(canvas).toContain(`test-id="${id}"`);
    }
    expect(canvas).not.toContain('window.prompt(');
    expect(canvas).not.toContain('class="wfs-mask"');
  });

  it('confirms destructive canvas actions inside the product', () => {
    expect(canvas).toContain("title: 'Archive workflow?'");
    expect(canvas).toContain("title: 'Delete test run?'");
    expect(canvas).toContain('await ui.requestConfirm({');
    expect(canvas).not.toMatch(/(?<!request)Confirm\(/);
  });

  it('announces successful workflow actions', () => {
    expect(canvas).toContain("title: 'Workflow settings saved'");
    expect(canvas).toContain("title: 'Workflow description saved'");
    expect(canvas).toContain("title: 'Workflow imported from URL'");
    expect(canvas).toContain("title: 'Workflow archived'");
  });

  it('makes the node editor a keyboard-contained dialog', () => {
    expect(ndv).toContain('role="dialog"');
    expect(ndv).toContain('aria-modal="true"');
    expect(ndv).toContain("event.key === 'Escape'");
    expect(ndv).toContain("event.key !== 'Tab'");
    expect(ndv).toContain('previouslyFocused?.focus()');
    expect(ndv).toContain('aria-label="Close node editor"');
    expect(ndv).not.toContain('>✕</button>');
  });

  it('keeps the three-column editor usable on narrow screens', () => {
    expect(ndv).toContain('@media (max-width: 900px)');
    expect(ndv).toContain('.ndv-body { overflow-x: auto; }');
    expect(ndv).toContain('.ndv-col.params { min-width: 360px; }');
  });

  it('keeps context-menu execution capability aligned with the node toolbar', () => {
    expect(workflowCanvas).toContain('const ctxCanExecute = computed(');
    expect(workflowCanvas).toContain('v-if="ctxCanExecute" class="ctx-item" data-test="ctx-execute"');
    expect(workflowCanvas).toContain("type === 'ai_tool'");
  });

  it('exposes the existing pin-data capability from the node context menu', () => {
    expect(workflowCanvas).toContain('data-test="ctx-pin"');
    expect(workflowCanvas).toContain('@click="ctxTogglePin"');
    expect(workflowCanvas).toContain("editor.pinNodeData(name, output)");
    expect(workflowCanvas).toContain("editor.unpinNodeData(name)");
  });

  it('gives every canvas context menu an accessible name', () => {
    expect(workflowCanvas).toContain('role="menu" aria-label="Canvas actions"');
    expect(workflowCanvas).toContain('aria-label="Sticky note actions"');
    expect(workflowCanvas).toContain('role="menu" aria-label="Node actions"');
  });

  it('closes either canvas context menu with Escape', () => {
    expect(workflowCanvas).toContain("event.key === 'Escape' && (ctxMenu.value || paneCtx.value)");
    expect(workflowCanvas).toContain('closeCtx();');
    expect(workflowCanvas).toContain('closePaneCtx();');
  });
});
