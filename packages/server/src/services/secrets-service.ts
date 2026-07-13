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
