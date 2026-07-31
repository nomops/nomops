import { sendSmtpMail } from '@nomops/nodes';

/**
 * SMTP 邮件投递（backlog #18/#51）。协议客户端由 nodes 层持有，Send Email 节点与服务通知共用；
 * 未配置 SMTP → NullMailer，邮件仍是增强而非注册/重置链路依赖。
 */
export interface IMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface IMailer {
  readonly enabled: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

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

export class NullMailer implements IMailer {
  readonly enabled = false;
  async send(to: string, subject: string): Promise<void> {
    console.log(`[nomops] SMTP 未配置,邮件未发送（${to} · ${subject}）——链接见上方日志/接口响应`);
  }
}

export class SmtpMailer implements IMailer {
  readonly enabled = true;
  constructor(private readonly config: IMailerConfig) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    await sendSmtpMail(
      {
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        user: this.config.user,
        password: this.config.pass,
      },
      { from: this.config.from, to, subject, text },
    );
  }
}
