import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function vueSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? vueSources(path) : extname(path) === '.vue' ? [readFileSync(path, 'utf8')] : [];
  });
}

const root = resolve(process.cwd(), 'src');
const allVue = vueSources(root).join('\n');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('global UI accessibility audit', () => {
  it('keeps browser-native dialogs out of product views', () => {
    expect(allVue).not.toMatch(/window\.(alert|confirm|prompt)\s*\(/);
  });

  it('uses semantic buttons instead of hash links for in-page actions', () => {
    expect(allVue).not.toContain('href="#"');
    expect(read('views/LoginView.vue')).toContain('class="auth-link button-link"');
    expect(read('views/OverviewView.vue')).toContain('class="wf-name button-link"');
  });

  it('uses accessible SVG controls instead of character close buttons', () => {
    expect(allVue).not.toMatch(/>\s*[✕×]\s*<\/button>/u);
    expect(read('components/canvas/NodePanel.vue')).toContain('aria-label="Close node panel"');
    expect(read('components/ui/UiToastHost.vue')).toContain('aria-label="Dismiss notification"');
  });

  it('moves shared informational and license surfaces onto UiDialog', () => {
    const sidebar = read('components/shell/SideBar.vue');
    const license = read('components/LicenseModal.vue');
    expect(sidebar).toContain('test-id="about-modal"');
    expect(sidebar).toContain('test-id="whats-new-modal"');
    expect(license).toContain('<UiDialog');
    expect(license).toContain('role="alert"');
  });

  it('gives every remaining settings modal an accessible dialog name', () => {
    const settings = read('views/SettingsView.vue');
    const cards = settings.match(/class="modal-card"/g) ?? [];
    const dialogs = settings.match(/class="modal-card" role="dialog" aria-modal="true" (?:aria-label|:aria-label)=/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(dialogs).toHaveLength(cards.length);
  });
});
