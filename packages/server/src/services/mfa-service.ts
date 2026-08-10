import { createHash, randomBytes } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';
import type { Repositories, User } from '@nomops/db';
import { generateTotp, verifyTotpCode } from '@nomops/nodes';
import type { Cipher } from '@nomops/core';

/**
 * 两步验证（TOTP，RFC 6238 / RFC 4648 base32）——零外部依赖，node:crypto 自实现。
 * 兼容 Google Authenticator / Authy 等（HMAC-SHA1、6 位、30s 步长）。
 *
 * 状态机：setup 生成 secret（enabled=false 待确认）→ enable 校验码后置 enabled=true。
 * 登录校验接受 TOTP 码或一次性备份码（备份码存 sha256 哈希，用后即删）。
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const SKEW_WINDOWS = 1; // 允许 ±1 个时间窗（前后 30s）容忍时钟漂移
const BACKUP_CODE_COUNT = 10;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 当前 TOTP 码（测试/生成用）。 */
export function totp(secretBase32: string, now = Date.now()): string {
  return generateTotp(secretBase32, { timestamp: now, digits: DIGITS, period: STEP_SECONDS });
}

/** 校验 TOTP 码（含 ±SKEW_WINDOWS 时间窗）。 */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): boolean {
  return verifyTotpCode(secretBase32, code, {
    timestamp: now,
    digits: DIGITS,
    period: STEP_SECONDS,
    window: SKEW_WINDOWS,
  });
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => randomBytes(5).toString('hex')); // 10 位十六进制
}

export interface MfaSetupResult {
  secret: string; // base32，供手动录入
  otpauthUri: string; // 供扫码
  backupCodes: string[]; // 明文，仅此一次返回
}

export class MfaService {
  constructor(
    private readonly repos: Repositories,
    private readonly cipher: Cipher,
    private readonly issuer = 'nomops',
  ) {}

  private async secretOf(user: User): Promise<string | null> {
    if (!user.mfaSecret) return null;
    if (user.mfaSecret.startsWith('v1:') || user.mfaSecret.startsWith('v2:')) {
      return this.cipher.decrypt(user.mfaSecret);
    }
    // 旧版本明文 secret：首次使用时原地迁成密文，保持无停机升级。
    await this.repos.users.setMfaState(user.id, { mfaSecret: await this.cipher.encrypt(user.mfaSecret) });
    return user.mfaSecret;
  }

  /** 发起设置：生成 secret + 备份码（存 secret + 备份码哈希，enabled 保持 false）。 */
  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new OperationalError('User not found', { status: 404 });
    const secret = base32Encode(randomBytes(20));
    const backupCodes = generateBackupCodes();
    await this.repos.users.setMfaState(userId, {
      mfaSecret: await this.cipher.encrypt(secret),
      mfaBackupCodes: backupCodes.map(hashCode),
      mfaEnabled: false,
    });
    const label = encodeURIComponent(`${this.issuer}:${user.email}`);
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(this.issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
    return { secret, otpauthUri, backupCodes };
  }

  /** 确认启用：校验 TOTP 码 → enabled=true。 */
  async enable(userId: string, code: string): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user?.mfaSecret) throw new OperationalError('Run two-factor setup first', { status: 400 });
    if (user.mfaEnabled) throw new OperationalError('Two-factor is already enabled', { status: 400 });
    const secret = await this.secretOf(user);
    if (!secret || !verifyTotp(secret, code)) throw new OperationalError('Invalid two-factor code', { status: 400 });
    await this.repos.users.setMfaState(userId, { mfaEnabled: true });
  }

  /** 停用：需一个有效码（TOTP 或备份码）→ 清空 secret/备份码。 */
  async disable(userId: string, code: string): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user?.mfaEnabled) throw new OperationalError('Two-factor is not enabled', { status: 400 });
    if (!(await this.verifyCode(user, code))) {
      throw new OperationalError('Invalid two-factor code', { status: 400 });
    }
    await this.repos.users.setMfaState(userId, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null });
  }

  /**
   * 登录时校验：先试 TOTP，再试一次性备份码（命中则消费）。
   * 供 AuthService 在 mfaEnabled 用户登录时调用。
   */
  async verifyCode(user: User, code: string): Promise<boolean> {
    const secret = await this.secretOf(user);
    if (!secret) return false;
    const normalized = code.replace(/\s/g, '');
    if (verifyTotp(secret, normalized)) return true;
    const codes = user.mfaBackupCodes ?? [];
    const idx = codes.indexOf(hashCode(normalized));
    if (idx === -1) return false;
    const remaining = codes.filter((_, i) => i !== idx);
    await this.repos.users.setMfaState(user.id, { mfaBackupCodes: remaining });
    return true;
  }
}
