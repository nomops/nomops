import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SettingsRepository } from '@nomops/db';
import type { IEncryptionKeyProvider } from '@nomops/core';
import { OperationalError } from '@nomops/workflow';

const KEYRING_SETTING = 'encryptionKeyring.v1';
const LEGACY_KEY_SETTING = 'encryptionKey';
const ALGORITHM = 'aes-256-gcm';

interface WrappedDek {
  wrapped: string;
  createdAt: string;
}

interface StoredKeyring {
  activeKeyId: string;
  legacyKeyId: string;
  keys: Record<string, WrappedDek>;
}

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error('NOMOPS_ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes');
  return key;
}

export function encryptionMasterKeyFromEnv(env: NodeJS.ProcessEnv): Buffer | null {
  const inline = env['NOMOPS_ENCRYPTION_KEY'] ?? env['NOMOPS_ENCRYPTION_MASTER_KEY'];
  const file = env['NOMOPS_ENCRYPTION_KEY_FILE'] ?? env['NOMOPS_ENCRYPTION_MASTER_KEY_FILE'];
  if (inline && file) throw new Error('Set only one of NOMOPS_ENCRYPTION_MASTER_KEY or NOMOPS_ENCRYPTION_MASTER_KEY_FILE');
  if (inline) return decodeKey(inline);
  if (file) return decodeKey(readFileSync(file, 'utf8'));
  return null;
}

/** External KEK + DB-stored wrapped DEKs. Plain keys never enter settings or API responses. */
export class EncryptionKeyService implements IEncryptionKeyProvider {
  private keyring: StoredKeyring | null = null;
  private readonly cache = new Map<string, Buffer>();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly masterKey: Buffer,
  ) {
    if (masterKey.length !== 32) throw new Error('Encryption master key must be exactly 32 bytes');
  }

  private wrap(id: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(key), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  }

  private unwrap(id: string, payload: string): Buffer {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new OperationalError('Wrapped encryption key format is invalid');
    try {
      const decipher = createDecipheriv(ALGORITHM, this.masterKey, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const key = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
      if (key.length !== 32) throw new Error('invalid DEK length');
      return key;
    } catch {
      throw new OperationalError('Cannot unwrap encryption key (master key mismatch or data corruption)');
    }
  }

  private newId(): string {
    return `dek-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
  }

  async initialize(): Promise<void> {
    if (this.keyring) return;
    const stored = await this.settings.get(KEYRING_SETTING);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredKeyring;
      if (!parsed.activeKeyId || !parsed.legacyKeyId || !parsed.keys?.[parsed.activeKeyId]) {
        throw new Error('Stored encryption keyring is invalid');
      }
      this.keyring = parsed;
      return;
    }

    const legacy = await this.settings.get(LEGACY_KEY_SETTING);
    const key = legacy ? Buffer.from(legacy, 'hex') : randomBytes(32);
    if (key.length !== 32) throw new Error('Legacy encryption key is invalid');
    const id = this.newId();
    const keyring: StoredKeyring = {
      activeKeyId: id,
      legacyKeyId: id,
      keys: { [id]: { wrapped: this.wrap(id, key), createdAt: new Date().toISOString() } },
    };
    await this.settings.set(KEYRING_SETTING, JSON.stringify(keyring), true);
    await this.settings.delete(LEGACY_KEY_SETTING);
    this.keyring = keyring;
    this.cache.set(id, key);
  }

  async getKey(): Promise<Buffer> {
    await this.initialize();
    return this.getKeyById(this.keyring!.legacyKeyId);
  }

  async getActiveKey(): Promise<{ id: string; key: Buffer }> {
    await this.initialize();
    const id = this.keyring!.activeKeyId;
    return { id, key: await this.getKeyById(id) };
  }

  async getKeyById(id: string): Promise<Buffer> {
    await this.initialize();
    const cached = this.cache.get(id);
    if (cached) return cached;
    const wrapped = this.keyring!.keys[id];
    if (!wrapped) throw new OperationalError('Encryption key ID is unknown');
    const key = this.unwrap(id, wrapped.wrapped);
    this.cache.set(id, key);
    return key;
  }

  async rotate(): Promise<{ activeKeyId: string; retainedKeys: number }> {
    await this.initialize();
    const id = this.newId();
    const key = randomBytes(32);
    this.keyring!.keys[id] = { wrapped: this.wrap(id, key), createdAt: new Date().toISOString() };
    this.keyring!.activeKeyId = id;
    await this.settings.set(KEYRING_SETTING, JSON.stringify(this.keyring), true);
    this.cache.set(id, key);
    return { activeKeyId: id, retainedKeys: Object.keys(this.keyring!.keys).length };
  }

  async status(): Promise<{ mode: 'external-envelope'; activeKeyId: string; retainedKeys: number }> {
    await this.initialize();
    return {
      mode: 'external-envelope',
      activeKeyId: this.keyring!.activeKeyId,
      retainedKeys: Object.keys(this.keyring!.keys).length,
    };
  }
}
