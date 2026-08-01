import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const edge = readFileSync(resolve(process.cwd(), 'src/components/canvas/CanvasEdge.vue'), 'utf8');

describe('canvas connection actions', () => {
  it('makes the connection hit area keyboard focusable and named', () => {
    expect(edge).toContain('role="button"');
    expect(edge).toContain('tabindex="0"');
    expect(edge).toContain('aria-label="Show connection actions"');
    expect(edge).toContain('.edge-hit:focus-visible');
  });

  it('opens connection actions with keyboard or touch', () => {
    expect(edge).toContain('@keydown.enter.prevent="hovered = true"');
    expect(edge).toContain('@keydown.space.prevent="toggleTools"');
    expect(edge).toContain('@click.stop="toggleTools"');
  });

  it('models the edge controls as a named toolbar', () => {
    expect(edge).toContain('role="toolbar"');
    expect(edge).toContain('aria-label="Connection actions"');
    expect(edge).toContain('.edge-tools:focus-within');
  });

  it('names both icon-only connection actions', () => {
    expect(edge).toContain('aria-label="Insert node into connection"');
    expect(edge).toContain('aria-label="Delete connection"');
  });
});
