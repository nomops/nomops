import { PassThrough, Readable } from 'node:stream';
import { Client as BasicFtpClient } from 'basic-ftp';
import SftpClient from 'ssh2-sftp-client';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export interface IRemoteFileClient {
  list(path: string): Promise<JsonObject[]>;
  download(path: string): Promise<Buffer>;
  upload(path: string, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

function iso(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === 'number' && value > 0 ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
}

function cleanPrivateKey(value: unknown): string | undefined {
  const key = typeof value === 'string' ? value.trim().replaceAll('\\n', '\n') : '';
  return key || undefined;
}

async function connectFtp(credentials: JsonObject, timeout: number): Promise<IRemoteFileClient> {
  const client = new BasicFtpClient(timeout);
  await client.access({
    host: String(credentials['host'] ?? ''),
    port: Number(credentials['port'] ?? 21),
    user: String(credentials['username'] ?? ''),
    password: String(credentials['password'] ?? ''),
    secure: credentials['secure'] === true,
  });
  return {
    async list(path) {
      return (await client.list(path)).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory ? 'directory' : entry.isSymbolicLink ? 'link' : 'file',
        size: entry.size,
        modifiedAt: iso(entry.modifiedAt),
        path: `${path.replace(/\/$/, '')}/${entry.name}` || '/',
      }));
    },
    async download(path) {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      await client.downloadTo(stream, path);
      return Buffer.concat(chunks);
    },
    async upload(path, data) { await client.uploadFrom(Readable.from(Buffer.from(data)), path); },
    async close() { client.close(); },
  };
}

async function connectSftp(credentials: JsonObject, timeout: number): Promise<IRemoteFileClient> {
  const client = new SftpClient();
  await client.connect({
    host: String(credentials['host'] ?? ''),
    port: Number(credentials['port'] ?? 22),
    username: String(credentials['username'] ?? ''),
    password: typeof credentials['password'] === 'string' && credentials['password'] ? credentials['password'] : undefined,
    privateKey: cleanPrivateKey(credentials['privateKey']),
    passphrase: typeof credentials['passphrase'] === 'string' && credentials['passphrase'] ? credentials['passphrase'] : undefined,
    readyTimeout: timeout,
  });
  return {
    async list(path) {
      return (await client.list(path)).map((entry) => ({
        name: entry.name,
        type: entry.type === 'd' ? 'directory' : entry.type === 'l' ? 'link' : 'file',
        size: entry.size,
        accessedAt: iso(entry.accessTime),
        modifiedAt: iso(entry.modifyTime),
        path: `${path.replace(/\/$/, '')}/${entry.name}` || '/',
      }));
    },
    async download(path) {
      const result = await client.get(path);
      if (Buffer.isBuffer(result)) return result;
      if (typeof result === 'string') return Buffer.from(result);
      throw new OperationalError('SFTP download returned an unsupported data stream', {});
    },
    async upload(path, data) { await client.put(Buffer.from(data), path); },
    async close() { await client.end(); },
  };
}

export async function connectRemoteFileClient(protocol: string, credentials: JsonObject, timeout: number): Promise<IRemoteFileClient> {
  try {
    return protocol === 'sftp' ? await connectSftp(credentials, timeout) : await connectFtp(credentials, timeout);
  } catch {
    throw new OperationalError(`${protocol.toUpperCase()} connection failed`, {});
  }
}
