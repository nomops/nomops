import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Socket } from 'node:net';
import { OperationalError } from '@nomops/workflow';

export interface ISmtpConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  disableStartTls?: boolean;
  clientHostname?: string;
  rejectUnauthorized?: boolean;
  timeout?: number;
}

export interface ISmtpMessage {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface ISmtpSendResult {
  accepted: string[];
  messageId: string;
}

interface ISmtpReply {
  code: number;
  lines: string[];
}

function safeHeader(value: string, name: string): string {
  const trimmed = value.trim();
  if (/\r|\n/.test(trimmed)) throw new OperationalError(`SMTP ${name} contains an invalid line break`, {});
  return trimmed;
}

function recipients(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.match(/<([^<>]+)>/)?.[1]?.trim() ?? part)
    .map((address) => safeHeader(address, 'recipient'));
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function dotStuff(value: string): string {
  return value.replaceAll('\r\n', '\n').split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

function messageIdDomain(envelopeFrom: string): string {
  const domain = envelopeFrom.split('@').at(-1)?.trim();
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? domain : 'nomops.local';
}

function messageBody(message: ISmtpMessage, messageId: string, idDomain: string): string {
  const from = safeHeader(message.from, 'from');
  const to = safeHeader(message.to, 'to');
  const cc = message.cc ? safeHeader(message.cc, 'cc') : '';
  const replyTo = message.replyTo ? safeHeader(message.replyTo, 'reply-to') : '';
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: =?UTF-8?B?${base64(safeHeader(message.subject, 'subject'))}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}@${idDomain}>`,
    'MIME-Version: 1.0',
  ];
  if (!message.html) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${dotStuff(message.text)}`;
  }
  const boundary = `nomops-${messageId}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(message.html),
    `--${boundary}--`,
  ].join('\r\n');
}

export async function sendSmtpMail(options: ISmtpConnectionOptions, message: ISmtpMessage): Promise<ISmtpSendResult> {
  const timeout = Math.max(1_000, options.timeout ?? 15_000);
  const hostname = safeHeader(options.clientHostname || 'nomops', 'client hostname');
  const envelopeFrom = recipients(message.from)[0];
  const accepted = [...recipients(message.to), ...recipients(message.cc ?? ''), ...recipients(message.bcc ?? '')];
  if (!options.host.trim() || !envelopeFrom || accepted.length === 0) {
    throw new OperationalError('SMTP requires a host, sender, and at least one recipient', {});
  }

  let socket: Socket = options.secure
    ? tlsConnect({
        host: options.host,
        port: options.port,
        servername: options.host,
        rejectUnauthorized: options.rejectUnauthorized !== false,
      })
    : createConnection({ host: options.host, port: options.port });
  socket.setTimeout(timeout);
  socket.on('error', () => undefined);
  let buffer = '';

  const readReply = (): Promise<ISmtpReply> =>
    new Promise((resolve, reject) => {
      const parse = (): boolean => {
        const lines = buffer.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (!/^\d{3} /.test(lines[index]!)) continue;
          const consumed = lines.slice(0, index + 1);
          buffer = lines.slice(index + 1).join('\n');
          cleanup();
          resolve({ code: Number(consumed[index]!.slice(0, 3)), lines: consumed });
          return true;
        }
        return false;
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        parse();
      };
      const onError = () => {
        cleanup();
        reject(new OperationalError('SMTP connection failed', {}));
      };
      const onTimeout = () => {
        cleanup();
        reject(new OperationalError('SMTP connection timed out', {}));
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

  const command = async (line: string, label: string, okBelow = 400): Promise<ISmtpReply> => {
    socket.write(`${line}\r\n`);
    const reply = await readReply();
    if (reply.code >= okBelow) throw new OperationalError(`SMTP ${label} failed (${reply.code})`, {});
    return reply;
  };

  try {
    const greeting = await readReply();
    if (greeting.code >= 400) throw new OperationalError(`SMTP greeting failed (${greeting.code})`, {});
    let capabilities = (await command(`EHLO ${hostname}`, 'EHLO')).lines.join('\n').toUpperCase();
    if (!options.secure && !options.disableStartTls && capabilities.includes('STARTTLS')) {
      await command('STARTTLS', 'STARTTLS');
      socket = tlsConnect({
        socket,
        servername: options.host,
        rejectUnauthorized: options.rejectUnauthorized !== false,
      });
      socket.setTimeout(timeout);
      socket.on('error', () => undefined);
      buffer = '';
      capabilities = (await command(`EHLO ${hostname}`, 'EHLO')).lines.join('\n').toUpperCase();
    }
    if (options.user && capabilities.includes('AUTH')) {
      await command('AUTH LOGIN', 'AUTH');
      await command(base64(options.user), 'AUTH username');
      await command(base64(options.password ?? ''), 'AUTH password');
    }
    await command(`MAIL FROM:<${envelopeFrom}>`, 'MAIL FROM');
    for (const recipient of accepted) await command(`RCPT TO:<${recipient}>`, 'RCPT TO');
    await command('DATA', 'DATA');
    const messageId = randomUUID();
    socket.write(`${messageBody(message, messageId, messageIdDomain(envelopeFrom))}\r\n.\r\n`);
    const completed = await readReply();
    if (completed.code >= 400) throw new OperationalError(`SMTP DATA failed (${completed.code})`, {});
    socket.write('QUIT\r\n');
    return { accepted, messageId };
  } catch (error) {
    if (error instanceof OperationalError) throw error;
    throw new OperationalError('SMTP delivery failed', {});
  } finally {
    socket.end();
    socket.destroy();
  }
}
