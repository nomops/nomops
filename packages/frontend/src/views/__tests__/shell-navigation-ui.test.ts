import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { titleFor } from '../../router.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), `src/${path}`), 'utf8');
const app = read('App.vue');
const sidebar = read('components/shell/SideBar.vue');
const palette = read('components/shell/CommandPalette.vue');

describe('global shell and navigation UI', () => {
  it('names every product route in the browser title', () => {
    expect(titleFor({ name: 'agents' })).toBe('Agents');
    expect(titleFor({ name: 'builder' })).toBe('AI Builder');
    expect(titleFor({ name: 'instanceAi' })).toBe('Assistant');
    expect(titleFor({ name: 'datatable' })).toBe('Data table');
    expect(titleFor({ name: 'ssoDone' })).toBe('Completing sign in');
  });

  it('keeps overview tab titles stable', () => {
    expect(titleFor({ name: 'overview', query: { tab: 'credentials' } })).toBe('Credentials');
    expect(titleFor({ name: 'overview', query: { tab: 'datatables' } })).toBe('Data tables');
    expect(titleFor({ name: 'overview', query: { tab: 'unknown' } })).toBe('Overview');
  });

  it('provides a skip link, main landmark, and route announcement', () => {
    expect(app).toContain('class="skip-link" href="#main-content"');
    expect(app).toContain('<main id="main-content"');
    expect(app).toContain('role="status" aria-live="polite"');
  });

  it('exposes sidebar navigation state and icon button names', () => {
    expect(sidebar).toContain('aria-label="Primary navigation"');
    expect(sidebar).toContain(':aria-current=');
    expect(sidebar).toContain(':aria-label="t(\'Search (⌘K)\')"');
    expect(sidebar).toContain('aria-controls="quick-create-menu"');
    expect(sidebar).toContain(':aria-expanded="quickOpen"');
  });

  it('models the command palette as an accessible combobox dialog', () => {
    expect(palette).toContain('role="dialog" aria-modal="true"');
    expect(palette).toContain('role="combobox"');
    expect(palette).toContain('role="listbox"');
    expect(palette).toContain('role="option"');
    expect(palette).toContain(':aria-activedescendant=');
  });
});
