import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { router, titleFor } from '../../router.js';

const routerSource = readFileSync(resolve(process.cwd(), 'src/router.ts'), 'utf8');
const viewNames = readdirSync(resolve(process.cwd(), 'src/views'))
  .filter((name) => name.endsWith('View.vue'))
  .sort();

describe('product route coverage', () => {
  it('keeps every top-level view reachable from the router', () => {
    for (const view of viewNames) expect(routerSource, view).toContain(`./views/${view}`);
  });

  it('gives every named page route a browser title', () => {
    const names = router.getRoutes().map((route) => route.name).filter(Boolean);
    for (const name of names) expect(titleFor({ name }), String(name)).not.toBe('');
  });

  it('resolves the assistant root to the stateful Assistant page', () => {
    expect(router.resolve('/assistant').name).toBe('instanceAi');
    expect(router.resolve({ name: 'instanceAi' }).path).toBe('/assistant');
  });

  it('keeps only authentication and SSO completion routes public', () => {
    const publicNames = router.getRoutes().filter((route) => route.meta['public']).map((route) => route.name).sort();
    expect(publicNames).toEqual(['login', 'signup', 'ssoDone']);
  });

  it('retains canonical Overview redirects for old resource URLs', () => {
    expect(router.resolve('/credentials').redirectedFrom).toBeUndefined();
    expect(routerSource).toContain("{ path: '/credentials', redirect: { path: '/', query: { tab: 'credentials' } } }");
    expect(routerSource).toContain("{ path: '/executions', redirect: { path: '/', query: { tab: 'executions' } } }");
  });
});
