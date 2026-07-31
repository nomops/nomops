import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Socket } from 'node:net';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export interface IImapMessage {
  uid: number;
  raw: Buffer;
}

export interface IImapClient {
  fetchSince(mailbox: string, lastUid: number, markAsRead: boolean): Promise<IImapMessage[]>;
  close(): Promise<void>;
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(/\r|\n/g, '')}"`;
}

function terminalIndex(buffer: Buffer, tag: string): number {
  const text = buffer.toString('latin1');
  const match = text.match(new RegExp(`(?:^|\\r?\\n)${tag} (?:OK|NO|BAD)[^\\r\\n]*(?:\\r?\\n|$)`, 'i'));
  return match?.index === undefined ? -1 : match.index + match[0].length;
}

function fetchLiteral(response: Buffer): Buffer | null {
  const text = response.toString('latin1');
  const match = text.match(/\{(\d+)\}\r\n/);
  if (match?.index === undefined) return null;
  const start = match.index + match[0].length;
  const length = Number(match[1]);
  if (!Number.isFinite(length) || response.byteLength < start + length) return null;
  return response.subarray(start, start + length);
}

export async function connectImapClient(credentials: JsonObject, timeout: number): Promise<IImapClient> {
  const host = String(credentials['host'] ?? '').trim();
  const port = Number(credentials['port'] ?? 993);
  const secure = credentials['secure'] !== false;
  const rejectUnauthorized = credentials['allowUnauthorizedCerts'] !== true;
  if (!host) throw new OperationalError('IMAP connection failed', {});
  const socket: Socket = secure
    ? tlsConnect({ host, port, servername: host, rejectUnauthorized })
    : createConnection({ host, port });
  socket.setTimeout(timeout);
  socket.on('error', () => undefined);
  let buffer = Buffer.alloc(0);
  let tagNumber = 0;

  const readUntil = (predicate: (value: Buffer) => number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const parse = (): boolean => {
        const end = predicate(buffer);
        if (end < 0) return false;
        const result = buffer.subarray(0, end);
        buffer = buffer.subarray(end);
        cleanup();
        resolve(result);
        return true;
      };
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        parse();
      };
      const onError = () => {
        cleanup();
        reject(new OperationalError('IMAP connection failed', {}));
      };
      const onTimeout = () => {
        cleanup();
        reject(new OperationalError('IMAP connection timed out', {}));
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
      };
      if (parse()) return;
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('timeout', onTimeout);
    });

  const command = async (value: string, label: string): Promise<Buffer> => {
    const tag = `A${++tagNumber}`;
    socket.write(`${tag} ${value}\r\n`);
    const response = await readUntil((current) => terminalIndex(current, tag));
    const terminal = response.toString('latin1').match(new RegExp(`${tag} (OK|NO|BAD)`, 'i'))?.[1]?.toUpperCase();
    if (terminal !== 'OK') throw new OperationalError(`IMAP ${label} failed`, {});
    return response;
  };

  try {
    const greeting = await readUntil((current) => {
      const index = current.indexOf('\r\n');
      return index < 0 ? -1 : index + 2;
    });
    if (!/^\* (OK|PREAUTH)/i.test(greeting.toString('utf8'))) throw new OperationalError('IMAP connection failed', {});
    if (!/^\* PREAUTH/i.test(greeting.toString('utf8'))) {
      await command(`LOGIN ${quote(String(credentials['user'] ?? ''))} ${quote(String(credentials['password'] ?? ''))}`, 'LOGIN');
    }
  } catch (error) {
    socket.destroy();
    if (error instanceof OperationalError) throw error;
    throw new OperationalError('IMAP connection failed', {});
  }

  return {
    async fetchSince(mailbox, lastUid, markAsRead) {
      await command(`${markAsRead ? 'SELECT' : 'EXAMINE'} ${quote(mailbox)}`, 'SELECT');
      const search = await command(`UID SEARCH UID ${Math.max(1, lastUid + 1)}:*`, 'SEARCH');
      const line = search.toString('utf8').match(/^\* SEARCH([^\r\n]*)/im)?.[1] ?? '';
      const uids = line.split(/\s+/).map(Number).filter((uid) => Number.isInteger(uid) && uid > lastUid);
      const messages: IImapMessage[] = [];
      const maxBytes = Math.max(1, Number(process.env['NOMOPS_IMAP_MAX_MESSAGE_BYTES'] ?? 10 * 1024 * 1024));
      for (const uid of uids) {
        const fetched = await command(`UID FETCH ${uid} (UID BODY.PEEK[])`, 'FETCH');
        const raw = fetchLiteral(fetched);
        if (!raw) throw new OperationalError('IMAP returned an invalid message payload', {});
        if (raw.byteLength > maxBytes) throw new OperationalError('IMAP message exceeds the configured size limit', {});
        messages.push({ uid, raw: Buffer.from(raw) });
        if (markAsRead) await command(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`, 'STORE');
      }
      return messages;
    },
    async close() {
      try {
        await command('LOGOUT', 'LOGOUT');
      } catch {
        // 对端提前关闭不影响已完成轮询。
      } finally {
        socket.end();
        socket.destroy();
      }
    },
  };
}
