import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { SmtpMailer, mailerConfigFromEnv, type IMailer } from '../services/mailer.js';

/**
 * SMTP 邮件投递（backlog #18）：
 * - 手搓客户端对假 SMTP 服务器全协议走通（EHLO/AUTH LOGIN/MAIL/RCPT/DATA/dot-stuffing）;
 * - 密码重置/邀请流真发邮件（记录桩）,未配置时不影响既有行为;
 * - env 解析（未配 host → null）。
 */

/** 进程内假 SMTP 服务器：按脚本应答,记录收到的命令与 DATA 正文。 */
function fakeSmtpServer(): Promise<{ server: Server; port: number; log: string[]; data: () => string }> {
  const log: string[] = [];
  let dataBuffer = '';
  const server = createServer((socket: Socket) => {
    let inData = false;
    socket.on('error', () => undefined); // 客户端 destroy 后的写读噪音不上抛
    socket.write('220 fake-smtp ready\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        dataBuffer += text;
        if (dataBuffer.includes('\r\n.\r\n')) {
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        log.push(line);
        const cmd = line.split(' ')[0]!.toUpperCase();
        if (cmd === 'EHLO') socket.write('250-fake-smtp\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n');
        else if (cmd === 'AUTH') socket.write('334 VXNlcm5hbWU6\r\n');
        else if (cmd === 'QUIT') socket.write('221 bye\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (/^[A-Za-z0-9+/=]+$/.test(line)) {
          // base64 的用户名/密码行
          socket.write(log.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).length === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 authenticated\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port, log, data: () => dataBuffer });
    });
  });
}

describe('SmtpMailer（手搓客户端）', () => {
  it('全协议走通:EHLO→AUTH LOGIN→MAIL→RCPT→DATA(dot-stuffing)', async () => {
    const fake = await fakeSmtpServer();
    const mailer = new SmtpMailer({
      host: '127.0.0.1',
      port: fake.port,
      secure: false,
      user: 'bot@corp.com',
      pass: 'hunter2',
      from: 'nomops@corp.com',
      rejectUnauthorized: true,
    });
    await mailer.send('alice@corp.com', '测试主题', 'line one\n.starts-with-dot\nReset link: https://x/y');
    fake.server.close();

    const log = fake.log.join('\n');
    expect(log).toContain('MAIL FROM:<nomops@corp.com>');
    expect(log).toContain('RCPT TO:<alice@corp.com>');
    expect(log).toContain('AUTH LOGIN');
    expect(log).toContain(Buffer.from('bot@corp.com').toString('base64'));
    const data = fake.data();
    expect(data).toContain('Subject: =?UTF-8?B?'); // UTF-8 主题编码
    expect(data).toMatch(/Message-ID: <[^>]+@corp\.com>/);
    expect(data).toContain('..starts-with-dot'); // dot-stuffing
    expect(data).toContain('Reset link: https://x/y');
  });

  it('env 解析:未配 host → null;465 → secure', () => {
    expect(mailerConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    const cfg = mailerConfigFromEnv({ NOMOPS_SMTP_HOST: 'smtp.x.com', NOMOPS_SMTP_PORT: '465' } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({ host: 'smtp.x.com', port: 465, secure: true, rejectUnauthorized: true });
    expect(
      mailerConfigFromEnv({ NOMOPS_SMTP_HOST: 'smtp.x.com', NOMOPS_SMTP_REJECT_UNAUTHORIZED: 'false' } as unknown as NodeJS.ProcessEnv),
    ).toMatchObject({ rejectUnauthorized: false });
  });
});

describe('流程接线（记录桩）', () => {
  let boot: BootstrapResult;
  let app: Express;
  let ownerToken: string;
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const stub: IMailer = {
    enabled: true,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, mailer: stub });
    app = createApp(boot.services);
    const reg = await request(app).post('/auth/register').send({ email: 'admin@mail.dev', password: 'password-123' }).expect(201);
    ownerToken = reg.body.token;
  });
  afterAll(async () => {
    await boot.shutdown();
  });

  it('密码重置发邮件（含重置链接;不存在的邮箱不发但响应恒 ok）', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await request(app).post('/auth/forgot').send({ email: 'admin@mail.dev' }).expect(200);
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget 落定
    const mail = sent.find((m) => m.subject.includes('Reset'));
    expect(mail?.to).toBe('admin@mail.dev');
    expect(mail?.text).toMatch(/\/login\?reset=/);
    expect(log.mock.calls.flat().join('\n')).not.toContain('/login?reset=');
    expect(log.mock.calls.flat().join('\n')).toContain('密码重置邮件发送成功');

    const before = sent.length;
    await request(app).post('/auth/forgot').send({ email: 'ghost@mail.dev' }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(before); // 不枚举:不存在的邮箱不发
    log.mockRestore();
  });

  it('邀请发邮件（含接受链接）', async () => {
    await request(app)
      .post('/api/instance/users/invite')
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ email: 'newbie@mail.dev', role: 'member' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));
    const mail = sent.find((m) => m.to === 'newbie@mail.dev');
    expect(mail?.subject).toContain('invited');
    expect(mail?.text).toMatch(/invite=/);
  });
});
