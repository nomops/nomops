import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Socket } from 'node:net';

/**
 * SMTP 邮件投递（backlog #18）。零依赖手搓最小客户端（同 /metrics、TOTP 的取舍）：
 * 支持 implicit TLS(465)/STARTTLS 升级/AUTH LOGIN,dot-stuffing,多行应答。
 * 未配置 SMTP → NullMailer(记日志,与既有行为一致)——邮件是增强,不是链路依赖。
 * ★邮件内容含重置/邀请链接（等同凭证）,失败时错误消息不携带正文。
 */
export interface IMailerConfig {
  host: string;
  port: number;
  /** true = implicit TLS(465);false = 明文起步,服务端播报 STARTTLS 则升级。 */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface IMailer {
  readonly enabled: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

/** NOMOPS_SMTP_HOST/PORT/SECURE/USER/PASS/FROM;未配 host → null（NullMailer）。 */
export function mailerConfigFromEnv(env: NodeJS.ProcessEnv): IMailerConfig | null {
  const host = env['NOMOPS_SMTP_HOST']?.trim();
  if (!host) return null;
  const port = Number(env['NOMOPS_SMTP_PORT'] ?? 587);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: env['NOMOPS_SMTP_SECURE'] === 'true' || port === 465,
    user: env['NOMOPS_SMTP_USER'] ?? '',
    pass: env['NOMOPS_SMTP_PASS'] ?? '',
    from: env['NOMOPS_SMTP_FROM'] ?? env['NOMOPS_SMTP_USER'] ?? 'nomops@localhost',
  };
}

/** 未配置 SMTP：保持既有「链接进日志」行为。 */
export class NullMailer implements IMailer {
  readonly enabled = false;
  async send(to: string, subject: string): Promise<void> {
    console.log(`[nomops] SMTP 未配置,邮件未发送（${to} · ${subject}）——链接见上方日志/接口响应`);
  }
}

const TIMEOUT_MS = 15_000;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export class SmtpMailer implements IMailer {
  readonly enabled = true;
  constructor(private readonly config: IMailerConfig) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const cfg = this.config;
    let socket: Socket = cfg.secure
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : createConnection({ host: cfg.host, port: cfg.port });
    socket.setTimeout(TIMEOUT_MS);
    // 常驻兜底监听:QUIT 后对端先断（ECONNRESET）不许变成未捕获异常
    socket.on('error', () => undefined);

    /** 读一条（可能多行的）应答：终止行是「3 位码 + 空格」。 */
    let buffer = '';
    const readReply = (): Promise<{ code: number; lines: string[] }> =>
      new Promise((resolve, reject) => {
        const tryParse = (): boolean => {
          const lines = buffer.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (/^\d{3} /.test(lines[i]!)) {
              const consumed = lines.slice(0, i + 1);
              buffer = lines.slice(i + 1).join('\n');
              cleanup();
              resolve({ code: Number(consumed[i]!.slice(0, 3)), lines: consumed });
              return true;
            }
          }
          return false;
        };
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          tryParse();
        };
        const onErr = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onTimeout = () => {
          cleanup();
          reject(new Error('SMTP timeout'));
        };
        const cleanup = () => {
          socket.off('data', onData);
          socket.off('error', onErr);
          socket.off('timeout', onTimeout);
        };
        if (tryParse()) return;
        socket.on('data', onData);
        socket.on('error', onErr);
        socket.on('timeout', onTimeout);
      });

    const cmd = async (line: string, okBelow = 400): Promise<{ code: number; lines: string[] }> => {
      socket.write(line + '\r\n');
      const reply = await readReply();
      if (reply.code >= okBelow) {
        throw new Error(`SMTP ${line.split(' ')[0]} failed: ${reply.code}`);
      }
      return reply;
    };

    try {
      await readReply(); // 220 greeting
      let caps = (await cmd('EHLO nomops')).lines.join('\n').toUpperCase();

      if (!cfg.secure && caps.includes('STARTTLS')) {
        await cmd('STARTTLS');
        socket = tlsConnect({ socket, servername: cfg.host });
        socket.setTimeout(TIMEOUT_MS);
        socket.on('error', () => undefined);
        buffer = '';
        caps = (await cmd('EHLO nomops')).lines.join('\n').toUpperCase();
      }

      if (cfg.user && caps.includes('AUTH')) {
        await cmd('AUTH LOGIN');
        await cmd(b64(cfg.user));
        await cmd(b64(cfg.pass));
      }

      await cmd(`MAIL FROM:<${cfg.from}>`);
      await cmd(`RCPT TO:<${to}>`);
      await cmd('DATA'); // 354
      const headers = [
        `From: ${cfg.from}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${b64(subject)}?=`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
      ];
      // dot-stuffing：正文行首的 '.' 翻倍
      const body = text.split('\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
      socket.write(headers.join('\r\n') + '\r\n\r\n' + body + '\r\n.\r\n');
      const done = await readReply();
      if (done.code >= 400) throw new Error(`SMTP DATA failed: ${done.code}`);
      socket.write('QUIT\r\n');
    } finally {
      socket.end();
      socket.destroy();
    }
  }
}
