import { createHmac, timingSafeEqual } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface ITotpOptions {
  algorithm?: TotpAlgorithm;
  digits?: 6 | 8;
  period?: number;
  timestamp?: number;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new OperationalError('TOTP secret must be valid Base32', {});
  }
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint, algorithm: TotpAlgorithm, digits: 6 | 8): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return (truncated % 10 ** digits).toString().padStart(digits, '0');
}

function resolveOptions(options: ITotpOptions): Required<ITotpOptions> {
  const period = options.period ?? 30;
  if (!Number.isInteger(period) || period < 1 || period > 3600) {
    throw new OperationalError('TOTP period must be an integer between 1 and 3600 seconds', {});
  }
  return {
    algorithm: options.algorithm ?? 'sha1',
    digits: options.digits ?? 6,
    period,
    timestamp: options.timestamp ?? Date.now(),
  };
}

export function generateTotp(secretBase32: string, options: ITotpOptions = {}): string {
  const resolved = resolveOptions(options);
  const counter = BigInt(Math.floor(resolved.timestamp / 1000 / resolved.period));
  return hotp(decodeBase32(secretBase32), counter, resolved.algorithm, resolved.digits);
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  options: ITotpOptions & { window?: number } = {},
): boolean {
  const resolved = resolveOptions(options);
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${resolved.digits}}$`).test(normalized)) return false;
  const window = options.window ?? 1;
  if (!Number.isInteger(window) || window < 0 || window > 10) {
    throw new OperationalError('TOTP window must be an integer between 0 and 10', {});
  }
  const secret = decodeBase32(secretBase32);
  const counter = BigInt(Math.floor(resolved.timestamp / 1000 / resolved.period));
  const candidate = Buffer.from(normalized);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(hotp(secret, counter + BigInt(offset), resolved.algorithm, resolved.digits));
    if (timingSafeEqual(expected, candidate)) return true;
  }
  return false;
}
