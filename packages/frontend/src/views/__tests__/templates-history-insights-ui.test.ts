import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), `src/views/${file}`), 'utf8');
const templates = read('TemplatesView.vue');
const history = read('WorkflowHistoryView.vue');
const insights = read('InsightsView.vue');

describe('templates, history, and insights UI', () => {
  it('separates template loading, error, empty, and filtered-empty states', () => {
    expect(templates).toContain('title="Loading templates"');
    expect(templates).toContain('title="Could not load templates"');
    expect(templates).toContain("templates.length ? 'No matching templates' : 'No templates available'");
    expect(templates).toContain('>Clear filters</button>');
  });

  it('routes credential-bearing imports through setup and direct imports to canvas', () => {
    expect(templates).toContain('template?.credentialRequirements.length');
    expect(templates).toContain("name: 'templateSetup'");
    expect(templates).toContain("query: { workflow: wf.id }");
    expect(templates).toContain("name: 'canvas'");
  });

  it('confirms version restoration and reports completed actions', () => {
    expect(history).toContain("title: 'Publish this version?'");
    expect(history).toContain('await ui.requestConfirm({');
    expect(history).toContain("title: 'Workflow version restored'");
    expect(history).toContain("title: 'Workflow cloned'");
  });

  it('makes version rows keyboard-operable and the upgrade link functional', () => {
    expect(history).toContain('tabindex="0"');
    expect(history).toContain('@keydown.enter.prevent="selectEntry(e)"');
    expect(history).toContain("router.push('/settings/usage')");
  });

  it('gives version history and insights explicit async states', () => {
    expect(history).toContain('title="Loading version history"');
    expect(history).toContain('title="Could not load version history"');
    expect(history).toContain('title="Loading publish timeline"');
    expect(insights).toContain('title="Could not load insights"');
    expect(insights).toContain('title="Loading execution insights"');
  });

  it('adapts historical and analytical layouts to narrow screens', () => {
    expect(history).toContain('@media (max-width: 820px)');
    expect(insights).toContain('@media (max-width: 560px)');
    expect(insights).toContain('grid-template-columns: 1fr');
  });
});
