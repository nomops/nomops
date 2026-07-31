import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt } from 'node:crypto';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, setPath } from '../../lib/data-transform.js';
import { cryptoDescription } from './Crypto.description.js';

type CryptoAction = 'hash' | 'hmac' | 'base64Encode' | 'base64Decode' | 'uuid' | 'encrypt' | 'decrypt';
type DigestAlgorithm = 'sha256' | 'sha384' | 'sha512';
type DigestEncoding = 'hex' | 'base64';

const cipherName = 'aes-256-gcm';
const payloadVersion = 'v1';

function deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function encrypt(value: string, secret: string): Promise<string> {
  if (!secret) throw new OperationalError('Crypto: encryption secret must not be empty', {});
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(secret, salt);
  const cipher = createCipheriv(cipherName, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [payloadVersion, salt.toString('base64url'), iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

async function decrypt(value: string, secret: string): Promise<string> {
  if (!secret) throw new OperationalError('Crypto: decryption secret must not be empty', {});
  const [version, saltValue, ivValue, tagValue, encryptedValue, extra] = value.split(':');
  if (version !== payloadVersion || !saltValue || !ivValue || !tagValue || encryptedValue === undefined || extra !== undefined) {
    throw new OperationalError('Crypto: invalid encrypted payload', {});
  }
  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const iv = Buffer.from(ivValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('invalid payload framing');
    const key = await deriveKey(secret, salt);
    const decipher = createDecipheriv(cipherName, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new OperationalError('Crypto: unable to decrypt value', {});
  }
}

async function processValue(action: CryptoAction, value: string, algorithm: DigestAlgorithm, encoding: DigestEncoding, secret: string): Promise<string> {
  if (action === 'hash') return createHash(algorithm).update(value, 'utf8').digest(encoding);
  if (action === 'hmac') {
    if (!secret) throw new OperationalError('Crypto: HMAC secret must not be empty', {});
    return createHmac(algorithm, secret).update(value, 'utf8').digest(encoding);
  }
  if (action === 'base64Encode') return Buffer.from(value, 'utf8').toString('base64');
  if (action === 'base64Decode') return Buffer.from(value, 'base64').toString('utf8');
  if (action === 'uuid') return randomUUID();
  if (action === 'encrypt') return encrypt(value, secret);
  if (action === 'decrypt') return decrypt(value, secret);
  throw new OperationalError(`Crypto: unsupported action "${action}"`, {});
}

export class Crypto implements INodeType {
  description = cryptoDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output = await Promise.all(this.getInputData().map(async (item, itemIndex) => {
      const action = String(this.getNodeParameter('action', itemIndex, 'hash')) as CryptoAction;
      const value = String(this.getNodeParameter('value', itemIndex, ''));
      const algorithm = String(this.getNodeParameter('algorithm', itemIndex, 'sha256')) as DigestAlgorithm;
      const encoding = String(this.getNodeParameter('encoding', itemIndex, 'hex')) as DigestEncoding;
      const secret = String(this.getNodeParameter('secret', itemIndex, ''));
      const result = await processValue(action, value, algorithm, encoding, secret);
      const json = cloneJsonObject(item.json);
      setPath(json, String(this.getNodeParameter('outputField', itemIndex, 'data')), result);
      return { ...item, json, pairedItem: { item: itemIndex } };
    }));
    return [output];
  }
}
