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

  it('keeps concurrent save conflicts visible and requires confirmation before discarding local work', () => {
    expect(canvas).toContain('data-test="save-conflict-banner"');
    expect(canvas).toContain('data-test="reload-after-conflict"');
    expect(canvas).toContain("title: 'Reload latest workflow?'");
    expect(canvas).toContain('Your local changes were not overwritten');
    expect(canvas).toContain('await editor.load(editor.id)');
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

  it('puts AI capability add controls at the bottom of the node editor', () => {
    expect(ndv).toContain('data-test="ndv-ai-capabilities"');
    expect(ndv).toContain("['ai_languageModel', 'ai_memory', 'ai_tool']");
    expect(ndv).toContain("editor.openAiNodePicker(node.value.name, type)");
    expect(ndv).toContain(':data-test-ai-add="capability.type"');
  });

  it('implements real Webhook test listening and HTTP cURL import controls', () => {
    expect(ndv).toContain("api.workflows.startWebhookTest(editor.id, node.value.name)");
    expect(ndv).toContain('Listening for test event');
    expect(ndv).toContain('Stop Listening');
    expect(ndv).toContain('data-test="http-import-curl"');
    expect(ndv).toContain('parseCurlCommand(curlDraft.value)');
    expect(ndv).toContain('This will overwrite any changes you have already made to the current node');
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

  it('connects the Focus panel trigger to a named complementary panel', () => {
    expect(canvas).toContain('aria-controls="workflow-focus-panel"');
    expect(canvas).toContain(':aria-expanded="editor.focusPanelOpen"');
    expect(canvas).toContain('id="workflow-focus-panel"');
    expect(canvas).toContain('aria-labelledby="focus-panel-title"');
  });

  it('keeps the Focus panel and node picker mutually exclusive', () => {
    expect(canvas).toContain('if (opening) editor.nodePickerOpen = false;');
    expect(canvas).toContain('if (open && editor.focusPanelOpen) closeFocusPanel(false);');
  });

  it('closes the Focus panel with Escape and restores its trigger', () => {
    expect(canvas).toContain("event.key === 'Escape' && editor.focusPanelOpen");
    expect(canvas).toContain('focusPanelTrigger.value?.focus()');
    expect(canvas).toContain('@click="closeFocusPanel()"');
  });

  it('uses the shared empty state for an unconfigured Focus panel', () => {
    expect(canvas).toContain("import UiState from '../components/ui/UiState.vue'");
    expect(canvas).toContain('title="Keep a parameter within reach"');
    expect(canvas).toContain('data-test="focus-empty"');
  });

  it('does not nest the new-session action inside the Chat disclosure button', () => {
    expect(canvas).toContain('<div v-if="hasChatTrigger" class="logs-head chat-head"');
    expect(canvas).toContain('aria-label="Start new chat session"');
    expect(canvas).not.toContain('<button v-if="hasChatTrigger" class="logs-head chat-head"');
  });

  it('connects both bottom-bar disclosures to the expanded panel', () => {
    expect(canvas).toContain('aria-controls="workflow-bottom-panel"');
    expect(canvas).toContain(':aria-expanded="logsOpen"');
    expect(canvas).toContain('id="workflow-bottom-panel"');
  });

  it('labels Chat and Logs regions and their empty states', () => {
    expect(canvas).toContain('aria-label="Workflow chat"');
    expect(canvas).toContain('aria-label="Execution logs"');
    expect(canvas).toContain('title="Test the Chat Trigger"');
    expect(canvas).toContain('title="No execution logs yet"');
  });

  it('uses honest expansion copy instead of claiming to open another view', () => {
    expect(canvas).toContain('aria-label="Expand execution logs"');
    expect(canvas).not.toContain('Open logs in a separate view');
  });

  it('models node log selection and Input/Output as accessible controls', () => {
    expect(canvas).toContain(':aria-pressed="selectedLogNode === row.name"');
    expect(canvas).toContain('role="tablist" aria-label="Node run data"');
    expect(canvas).toContain('role="tabpanel"');
  });

  it('shows every Agent tool invocation separately in execution details', () => {
    expect(canvas).toContain("run.data?.['main']?.[0] ?? run.data?.['ai_tool']?.[0]");
    expect(canvas).toContain(':data-test-tool-call="r.toolCall?.callId"');
    expect(canvas).toContain('{{ r.toolCall.toolName }} · {{ r.toolCall.callId }}');
  });

  it('uses SVG icons for add, execute, and stop instead of character glyphs', () => {
    expect(canvas).toContain('class="first-step-icon"');
    expect(canvas).toContain('class="execute-label"');
    expect(canvas).not.toContain('<span class="plus">＋</span>');
    expect(canvas).not.toContain('■ Stop execution');
    expect(canvas).not.toContain('▶ Execute workflow');
  });

  it('connects the trigger disclosure to a named menu', () => {
    expect(canvas).toContain('aria-label="Choose start trigger"');
    expect(canvas).toContain('aria-controls="run-trigger-menu"');
    expect(canvas).toContain(':aria-expanded="execMenuOpen"');
    expect(canvas).toContain('role="menu" aria-label="Start from trigger"');
  });

  it('models start triggers as a single-choice menu', () => {
    expect(canvas).toContain('role="menuitemradio"');
    expect(canvas).toContain(':aria-checked="name === selectedTrigger"');
  });

  it('closes the start-trigger menu with Escape and announces run failures', () => {
    expect(canvas).toContain("event.key === 'Escape' && execMenuOpen.value");
    expect(canvas).toContain('class="run-error-toast" role="alert"');
  });

  it('names the canvas toolbar and each icon-only action', () => {
    expect(canvas).toContain('role="toolbar" aria-label="Canvas tools"');
    expect(canvas).toContain('aria-label="Open nodes panel"');
    expect(canvas).toContain('aria-label="Open command bar" aria-haspopup="dialog"');
    expect(canvas).toContain('aria-label="Add sticky note"');
  });
});
