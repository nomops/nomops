import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export interface ISshCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface ISshClient {
  execute(command: string, cwd?: string): Promise<ISshCommandResult>;
  download(path: string): Promise<Buffer>;
  upload(path: string, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

function privateKey(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim().replaceAll('\\n', '\n') : '';
  return normalized || undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function sftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, wrapper) => error ? reject(error) : resolve(wrapper));
  });
}

function readRemoteFile(wrapper: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    wrapper.readFile(path, (error, data) => error ? reject(error) : resolve(Buffer.from(data)));
  });
}

function writeRemoteFile(wrapper: SFTPWrapper, path: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    wrapper.writeFile(path, Buffer.from(data), (error) => error ? reject(error) : resolve());
  });
}

export async function connectSshClient(credentials: JsonObject, timeout: number): Promise<ISshClient> {
  const client = new Client();
  const expectedFingerprint = String(credentials['hostFingerprint'] ?? '').trim().replace(/^SHA256:/i, '');
  const config: ConnectConfig = {
    host: String(credentials['host'] ?? ''),
    port: Number(credentials['port'] ?? 22),
    username: String(credentials['username'] ?? ''),
    password: typeof credentials['password'] === 'string' && credentials['password'] ? credentials['password'] : undefined,
    privateKey: privateKey(credentials['privateKey']),
    passphrase: typeof credentials['passphrase'] === 'string' && credentials['passphrase'] ? credentials['passphrase'] : undefined,
    readyTimeout: timeout,
    ...(expectedFingerprint
      ? { hostHash: 'sha256', hostVerifier: (hash: string) => hash === expectedFingerprint }
      : {}),
  };
  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', () => reject(new OperationalError('SSH connection failed', {})));
    try {
      client.connect(config);
    } catch {
      reject(new OperationalError('SSH connection failed', {}));
    }
  });

  return {
    execute(command, cwd) {
      const remoteCommand = cwd ? `cd -- ${shellQuote(cwd)} && ${command}` : command;
      return new Promise<ISshCommandResult>((resolve, reject) => {
        client.exec(remoteCommand, (error, stream: ClientChannel) => {
          if (error) {
            reject(new OperationalError('SSH command failed to start', {}));
            return;
          }
          const stdout: Buffer[] = [];
          const stderr: Buffer[] = [];
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            stream.close();
            reject(new OperationalError('SSH command timed out', {}));
          }, timeout);
          stream.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
          stream.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
          stream.once('close', (exitCode: number | undefined, signal: string | undefined) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
              stdout: Buffer.concat(stdout).toString('utf8'),
              stderr: Buffer.concat(stderr).toString('utf8'),
              exitCode: typeof exitCode === 'number' ? exitCode : null,
              signal: signal ?? null,
            });
          });
          stream.once('error', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new OperationalError('SSH command failed', {}));
          });
        });
      });
    },
    async download(path) {
      try {
        const data = await readRemoteFile(await sftp(client), path);
        const maxBytes = Math.max(1, Number(process.env['NOMOPS_SSH_MAX_FILE_BYTES'] ?? 64 * 1024 * 1024));
        if (data.byteLength > maxBytes) throw new OperationalError('SSH download exceeds the configured size limit', {});
        return data;
      } catch (error) {
        if (error instanceof OperationalError) throw error;
        throw new OperationalError('SSH download failed', {});
      }
    },
    async upload(path, data) {
      try {
        await writeRemoteFile(await sftp(client), path, data);
      } catch {
        throw new OperationalError('SSH upload failed', {});
      }
    },
    async close() {
      client.end();
    },
  };
}
