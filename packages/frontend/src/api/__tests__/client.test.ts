import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, projectStorage, tokenStorage } from '../client.js';

function mockFetch(): { headers: () => Record<string, string> } {
  let captured: Record<string, string> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured = (init.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
  return { headers: () => captured };
}

describe('API client 请求头（docs/06 项目上下文）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStorage.clear();
    projectStorage.clear();
  });

  it('注入 Authorization 与 X-Project-Id', async () => {
    const captured = mockFetch();
    tokenStorage.set('jwt-abc');
    projectStorage.set('proj-1');
    await api.projects.list();
    expect(captured.headers()['authorization']).toBe('Bearer jwt-abc');
    expect(captured.headers()['x-project-id']).toBe('proj-1');
  });

  it('未选项目时不带 X-Project-Id（回落 token 默认项目）', async () => {
    const captured = mockFetch();
    tokenStorage.set('jwt-abc');
    await api.workflows.list();
    expect(captured.headers()['x-project-id']).toBeUndefined();
  });
});
