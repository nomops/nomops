import { describe, expect, it, vi } from 'vitest';
import { VaultSecretsProvider, secretsProviderFromEnv, EnvSecretsProvider } from '../ee/services/secrets-service.js';

/**
 * External Secrets 多 provider（backlog #23）：HashiCorp Vault KV v2。
 * 快照 + 后台刷新保持同步 get() 接口;首刷失败 provider 不可用不抛;factory 按 env 选 provider。
 */

/** 假 Vault：按 KV v2 形状回 { data: { data: {...} } }。 */
function fakeVaultFetch(kv: Record<string, unknown>, opts: { fail?: boolean; expectPath?: string } = {}) {
  return vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    if (opts.expectPath) expect(url).toContain(opts.expectPath);
    expect(init?.headers?.['X-Vault-Token']).toBe('tok-123');
    if (opts.fail) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => ({ data: { data: kv } }) } as unknown as Response;
  });
}

describe('VaultSecretsProvider', () => {
  it('拉 KV v2 快照后 get/keys/available 同步命中;非字符串值 JSON 化', async () => {
    const fetchImpl = fakeVaultFetch({ API_KEY: 'sk-live-9', PORT: 8080, cfg: { a: 1 } }, { expectPath: '/v1/secret/data/nomops' });
    const provider = new VaultSecretsProvider({ addr: 'https://vault:8200/', token: 'tok-123', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(provider.available()).toBe(false); // 未刷新前不可用
    await provider.refresh();
    expect(provider.available()).toBe(true);
    expect(provider.keys().sort()).toEqual(['API_KEY', 'PORT', 'cfg']);
    expect(provider.get('API_KEY')).toBe('sk-live-9');
    expect(provider.get('PORT')).toBe('8080'); // 数值 → 字符串
    expect(provider.get('cfg')).toBe('{"a":1}'); // 对象 → JSON
    expect(provider.get('MISSING')).toBeUndefined();
    expect(provider.name()).toBe('HashiCorp Vault');
  });

  it('自定义 mount/path 拼到 URL', async () => {
    const fetchImpl = fakeVaultFetch({ X: 'y' }, { expectPath: '/v1/kv2/data/apps/nomops' });
    const provider = new VaultSecretsProvider({
      addr: 'https://vault:8200',
      token: 'tok-123',
      mount: 'kv2',
      path: 'apps/nomops',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.refresh();
    expect(provider.get('X')).toBe('y');
  });

  it('start() 首刷失败 → provider 不可用但不抛(业务不受影响)', async () => {
    const fetchImpl = fakeVaultFetch({}, { fail: true });
    const provider = new VaultSecretsProvider({ addr: 'https://vault:8200', token: 'tok-123', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.start()).resolves.toBeUndefined(); // 不抛
    expect(provider.available()).toBe(false);
    provider.stop();
  });
});

describe('secretsProviderFromEnv', () => {
  it('默认 → EnvSecretsProvider,无 start', () => {
    const sel = secretsProviderFromEnv({} as NodeJS.ProcessEnv);
    expect(sel.provider).toBeInstanceOf(EnvSecretsProvider);
    expect(sel.start).toBeUndefined();
  });

  it('NOMOPS_SECRETS_PROVIDER=vault + addr/token → VaultProvider + start', () => {
    const sel = secretsProviderFromEnv({
      NOMOPS_SECRETS_PROVIDER: 'vault',
      NOMOPS_VAULT_ADDR: 'https://vault:8200',
      NOMOPS_VAULT_TOKEN: 'tok',
    } as unknown as NodeJS.ProcessEnv);
    expect(sel.provider).toBeInstanceOf(VaultSecretsProvider);
    expect(typeof sel.start).toBe('function');
  });

  it('vault 但缺 addr/token → 回落 EnvSecretsProvider', () => {
    const sel = secretsProviderFromEnv({ NOMOPS_SECRETS_PROVIDER: 'vault' } as unknown as NodeJS.ProcessEnv);
    expect(sel.provider).toBeInstanceOf(EnvSecretsProvider);
  });
});
