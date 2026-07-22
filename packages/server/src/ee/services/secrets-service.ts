import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { LicenseService } from '../license/license-service.js';

/**
 * 外部密钥（docs/10 B4，企业功能 `externalSecrets`）。
 *
 * 动机：把第三方密钥（API key 等）放在集中的 secrets 后端，凭证里只存**引用**
 * `{{ $secrets.KEY }}`，执行注入节点的瞬间才物化为真值。好处：
 * - 密钥轮换只改 secrets 后端，不用逐个改凭证
 * - DB 里的凭证密文即使泄露也只含引用，不含真实第三方密钥
 *
 * ★铁律 3 延伸：secret 值只在解密注入链路上出现，绝不落库/出 API/进日志；
 *   status() 只暴露 provider 名与 key 名清单，永不暴露值。
 *
 * provider 可插拔：当前 env 变量实现（`NOMOPS_SECRET_<KEY>`），
 * 后续可换 Vault / AWS Secrets Manager，业务零改动。
 */
export interface ISecretsProvider {
  /** provider 展示名（如 "环境变量"）。 */
  name(): string;
  /** provider 是否就绪（如至少配置了一个 key）。 */
  available(): boolean;
  /** 全部 key 名（**仅名字，不含值**）。 */
  keys(): string[];
  /** 取某个 key 的值；不存在返回 undefined。 */
  get(key: string): string | undefined;
}

/** 从 `NOMOPS_SECRET_<KEY>` 环境变量读密钥。KEY 大小写敏感，按前缀后的原文。 */
export class EnvSecretsProvider implements ISecretsProvider {
  private static readonly PREFIX = 'NOMOPS_SECRET_';

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  name(): string {
    return 'Environment variables';
  }

  available(): boolean {
    return this.keys().length > 0;
  }

  keys(): string[] {
    return Object.keys(this.env)
      .filter((k) => k.startsWith(EnvSecretsProvider.PREFIX) && k.length > EnvSecretsProvider.PREFIX.length)
      .map((k) => k.slice(EnvSecretsProvider.PREFIX.length));
  }

  get(key: string): string | undefined {
    return this.env[`${EnvSecretsProvider.PREFIX}${key}`];
  }
}

/**
 * HashiCorp Vault（KV v2）provider。
 *
 * 同步接口约束（`get`/`keys` 同步——注入链路深处调用，改 async 会级联全链）：
 * 内存持有一份密钥快照，后台按 refreshMs 拉取一次 Vault 路径（KV v2 读整个 path 返回
 * key→value 的 map）。`get()` 命中快照，永不阻塞注入。首次 refresh 失败不抛（provider
 * 视为不可用），业务不受影响；值只在快照内存里，绝不落库/出 API（status 只出 key 名）。
 *
 * fetchImpl 可注入（测试用进程内假 Vault，不打真实网络）。
 */
export interface IVaultOptions {
  /** Vault 地址，如 https://vault.internal:8200。 */
  addr: string;
  /** 认证 token（X-Vault-Token 头）。 */
  token: string;
  /** KV v2 mount 名（默认 secret）。 */
  mount?: string;
  /** mount 下的 secret 路径（默认 nomops）。 */
  path?: string;
  /** 快照刷新间隔毫秒（默认 5 分钟）。 */
  refreshMs?: number;
  /** 自定义 fetch（测试注入）。 */
  fetchImpl?: typeof fetch;
}

export class VaultSecretsProvider implements ISecretsProvider {
  private snapshot: Record<string, string> = {};
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly mount: string;
  private readonly path: string;
  private readonly refreshMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: IVaultOptions) {
    this.mount = options.mount || 'secret';
    this.path = options.path || 'nomops';
    this.refreshMs = options.refreshMs ?? 5 * 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** 启动首刷 + 定时刷新（bootstrap 在 leader/所有进程都可调；只读，无副作用冲突）。 */
  async start(): Promise<void> {
    await this.refresh().catch(() => undefined); // 首刷失败:provider 暂不可用,不阻断启动
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 拉一次 Vault KV v2:GET <addr>/v1/<mount>/data/<path> → data.data 是 key→value。 */
  async refresh(): Promise<void> {
    const url = `${this.options.addr.replace(/\/+$/, '')}/v1/${this.mount}/data/${this.path}`;
    const res = await this.fetchImpl(url, { headers: { 'X-Vault-Token': this.options.token } });
    if (!res.ok) throw new OperationalError(`Vault read failed: HTTP ${res.status}`, { status: 502 });
    const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const kv = body.data?.data ?? {};
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(kv)) next[k] = typeof v === 'string' ? v : JSON.stringify(v);
    this.snapshot = next;
    this.loaded = true;
  }

  name(): string {
    return 'HashiCorp Vault';
  }
  available(): boolean {
    return this.loaded && Object.keys(this.snapshot).length > 0;
  }
  keys(): string[] {
    return Object.keys(this.snapshot);
  }
  get(key: string): string | undefined {
    return this.snapshot[key];
  }
}

/**
 * 从环境变量选 provider（默认 env 变量 provider）：
 * NOMOPS_SECRETS_PROVIDER=vault + NOMOPS_VAULT_ADDR/TOKEN[/MOUNT/PATH] → Vault。
 * 返回 [provider, start?]:start 供 bootstrap 调用（Vault 需要预热快照）。
 */
export function secretsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): {
  provider: ISecretsProvider;
  start?: () => Promise<void>;
} {
  if (env['NOMOPS_SECRETS_PROVIDER'] === 'vault' && env['NOMOPS_VAULT_ADDR'] && env['NOMOPS_VAULT_TOKEN']) {
    const vault = new VaultSecretsProvider({
      addr: env['NOMOPS_VAULT_ADDR'],
      token: env['NOMOPS_VAULT_TOKEN'],
      ...(env['NOMOPS_VAULT_MOUNT'] ? { mount: env['NOMOPS_VAULT_MOUNT'] } : {}),
      ...(env['NOMOPS_VAULT_PATH'] ? { path: env['NOMOPS_VAULT_PATH'] } : {}),
    });
    return { provider: vault, start: () => vault.start() };
  }
  return { provider: new EnvSecretsProvider(env) };
}

/** `{{ $secrets.KEY }}` 引用匹配（允许内外空白；KEY 为字母/数字/下划线）。 */
const SECRET_REF = /\{\{\s*\$secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

export interface SecretsStatus {
  provider: string;
  available: boolean;
  enabled: boolean;
  keys: string[];
}

export class SecretsService {
  constructor(
    private readonly provider: ISecretsProvider,
    private readonly license: LicenseService,
  ) {}

  private enabled(): boolean {
    return this.license.isFeatureEnabled('externalSecrets');
  }

  /** provider 状态 + key 名清单（绝不含值）。 */
  status(): SecretsStatus {
    const enabled = this.enabled();
    return {
      provider: this.provider.name(),
      available: this.provider.available(),
      enabled,
      keys: enabled ? this.provider.keys() : [],
    };
  }

  /**
   * 深度遍历，把字符串里的 `{{ $secrets.KEY }}` 替换为真值。
   * - 未启用企业版但检测到引用 → 抛错（避免把引用当明文泄露给下游）
   * - 引用了不存在的 key → 抛错（fail-fast，避免静默空值）
   * 无引用则原样返回（零开销）。
   */
  resolve<T>(value: T): T {
    return this.walk(value) as T;
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') return this.resolveString(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value && typeof value === 'object') {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.walk(v);
      return out;
    }
    return value;
  }

  private resolveString(str: string): string {
    SECRET_REF.lastIndex = 0;
    if (!SECRET_REF.test(str)) return str;
    if (!this.enabled()) {
      throw new OperationalError('References an external secret ($secrets); this feature requires an Enterprise license', {
        feature: 'externalSecrets',
        status: 403,
      });
    }
    SECRET_REF.lastIndex = 0;
    return str.replace(SECRET_REF, (_m, key: string) => {
      const val = this.provider.get(key);
      if (val === undefined) {
        throw new OperationalError(`External secret not found: ${key}`, { status: 400 });
      }
      return val;
    });
  }
}
