import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), `src/${path}`), 'utf8');
const palette = read('components/shell/CommandPalette.vue');
const overview = read('views/OverviewView.vue');
const router = read('router.ts');

describe('command palette UI', () => {
  it('opens create and existing credentials directly', () => {
    expect(palette).toContain("go('/?tab=credentials&new=cred')");
    expect(palette).toContain('credential=${encodeURIComponent(c.id)}');
    expect(overview).toContain('openCredentialFromRoute');
    expect(overview).toContain("route.query['credential']");
  });

  it('uses the canonical data tables tab route and title', () => {
    expect(palette).toContain("go('/?tab=data-tables')");
    expect(router).toContain("'data-tables': 'Data tables'");
  });

  it('distinguishes loading, failure, retry, and no-match states', () => {
    expect(palette).toContain('title="Loading commands"');
    expect(palette).toContain('title="Could not load commands"');
    expect(palette).toContain('@click="loadResources"');
    expect(palette).toContain('title="No matching commands"');
  });

  it('wraps keyboard selection and keeps it visible', () => {
    expect(palette).toContain('(active.value + 1) % results.value.length');
    expect(palette).toContain('(active.value - 1 + results.value.length) % results.value.length');
    expect(palette).toContain("scrollIntoView({ block: 'nearest' })");
  });

  it('traps focus, restores the trigger, and reports create failures', () => {
    expect(palette).toContain('previouslyFocused?.focus()');
    expect(palette).toContain("e.key === 'Tab'");
    expect(palette).toContain("title: 'Workflow created'");
    expect(palette).toContain("title: 'Could not create workflow'");
  });
});
