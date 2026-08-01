import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/views/BuilderView.vue'), 'utf8');

describe('AI Builder UI', () => {
  it('honors deep-linked builder session ids', () => {
    expect(source).toContain("const route = useRoute()");
    expect(source).toContain("route.params['id']");
    expect(source).toContain("router.replace({ name: 'builder', params: { id: s.id } })");
  });

  it('separates list, detail, error, and empty states', () => {
    expect(source).toContain('title="Loading builder sessions"');
    expect(source).toContain('title="Could not load builder sessions"');
    expect(source).toContain('title="No builder sessions yet"');
    expect(source).toContain('title="Loading builder session"');
    expect(source).toContain('title="No draft yet"');
  });

  it('confirms revision restoration and session discard', () => {
    expect(source).toContain("title: 'Restore this revision?'");
    expect(source).toContain("title: 'Discard builder session?'");
    expect(source).toContain('await ui.requestConfirm({');
  });

  it('reports successful revisions and workflow application', () => {
    expect(source).toContain("title: 'Builder revision restored'");
    expect(source).toContain("title: 'Draft applied to workflow'");
    expect(source).toContain("title: 'Builder session created'");
  });

  it('uses accessible icons and responsive three-pane layouts', () => {
    expect(source).toContain('aria-label="Discard builder session"');
    expect(source).not.toContain('>✕</button>');
    expect(source).toContain('@media (max-width: 1100px)');
    expect(source).toContain('@media (max-width: 720px)');
  });
});
