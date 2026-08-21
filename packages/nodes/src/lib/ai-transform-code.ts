import { OperationalError } from '@nomops/workflow';

export type AiTransformFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'mixed';

export interface AiTransformInputField {
  path: string;
  type: AiTransformFieldType;
}

const BLOCKED_CODE = [
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\beval\b/,
  /\bFunction\b/,
  /\bconstructor\b/,
  /\b__proto__\b/,
  /\bprototype\b/,
  /\bWebAssembly\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bimport\s*\(/,
] as const;

/**
 * Generated transforms get a narrower policy than the user-authored Code node.
 * Runtime isolation is still enforced by the existing empty-env subprocess.
 */
export function validateAiTransformCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!code || code.length > 12_000 || !/\breturn\b/.test(code)) {
    throw new OperationalError('Generated transform code is invalid');
  }
  if (BLOCKED_CODE.some((pattern) => pattern.test(code))) {
    throw new OperationalError('Generated transform code violates the safety policy');
  }
  return code;
}
