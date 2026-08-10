import { createHmac } from 'node:crypto';
import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/** Persistent IP + account login throttling. Bucket keys are HMACs, never raw identifiers. */
export class AuthRateLimitService {
  constructor(
    private readonly repos: Repositories,
    private readonly hmacKey: string,
  ) {}

  private keys(email: string, ip: string): { account: string; ip: string } {
    const hash = (kind: string, value: string) =>
      createHmac('sha256', this.hmacKey).update(`${kind}:${value}`).digest('hex');
    return {
      account: hash('account', email.trim().toLowerCase()),
      ip: hash('ip', ip || 'unknown'),
    };
  }

  async assertAllowed(email: string, ip: string, now = Date.now()): Promise<void> {
    for (const key of Object.values(this.keys(email, ip))) {
      const bucket = await this.repos.authRateLimits.get(key);
      if (bucket?.blockedUntil && bucket.blockedUntil.getTime() > now) {
        throw new OperationalError('Too many login attempts. Try again later.', {
          status: 429,
          retryAfterSeconds: Math.ceil((bucket.blockedUntil.getTime() - now) / 1000),
        });
      }
    }
  }

  async recordFailure(email: string, ip: string, now = Date.now()): Promise<void> {
    for (const key of Object.values(this.keys(email, ip))) {
      const current = await this.repos.authRateLimits.get(key);
      const inWindow = current && now - current.windowStart.getTime() < WINDOW_MS;
      const failures = inWindow ? current.failures + 1 : 1;
      await this.repos.authRateLimits.set(key, {
        failures,
        windowStart: inWindow ? current.windowStart : new Date(now),
        blockedUntil: failures >= MAX_FAILURES ? new Date(now + BLOCK_MS) : null,
      });
    }
  }

  async clear(email: string, ip: string): Promise<void> {
    // 成功登录只清账户桶。保留 IP 桶可防攻击者用自己的有效账户反复清空来源 IP 限流。
    await this.repos.authRateLimits.delete(this.keys(email, ip).account);
  }
}
