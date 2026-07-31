import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IBinaryData, IExecuteContext, INodeExecutionData, IPollContext, JsonObject } from '@nomops/workflow';
import { connectSshClient } from '../../lib/ssh-client.js';
import { sendSmtpMail } from '../../lib/smtp-client.js';
import { EmailTrigger } from '../EmailTrigger/EmailTrigger.node.js';
import { SendEmail } from '../SendEmail/SendEmail.node.js';
import { Ssh } from '../Ssh/Ssh.node.js';

vi.mock('../../lib/ssh-client.js', () => ({ connectSshClient: vi.fn() }));

function binary(data: string, fileName = 'file.txt'): IBinaryData {
  return { data: Buffer.from(data).toString('base64'), mimeType: 'text/plain', fileName, fileSize: Buffer.byteLength(data) };
}

function executeContext(
  items: INodeExecutionData[],
  parameters: Record<string, unknown>,
  credentials: Record<string, JsonObject>,
): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name, _index, fallback) => parameters[name] ?? fallback,
    getCredentials: async (type) => credentials[type] ?? {},
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    helpers: {
      httpRequest: async () => ({}),
      binaryToBuffer: async (value) => Buffer.from(value.data ?? '', 'base64'),
      bufferToBinary: async (value, meta) => ({
        data: Buffer.from(value).toString('base64'),
        mimeType: meta.mimeType,
        fileName: meta.fileName,
        fileSize: value.byteLength,
      }),
    },
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function fakeSmtp(options: { rejectPassword?: boolean } = {}): {
  server: Server;
  commands: string[];
  body: () => string;
} {
  const commands: string[] = [];
  let body = '';
  const server = createServer((socket: Socket) => {
    let inData = false;
    let authLines = 0;
    socket.on('error', () => undefined);
    socket.write('220 test SMTP\r\n');
    socket.on('data', (chunk) => {
      const value = chunk.toString('utf8');
      if (inData) {
        body += value;
        if (body.includes('\r\n.\r\n')) {
          inData = false;
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (const line of value.split('\r\n').filter(Boolean)) {
        commands.push(line);
        const command = line.split(' ')[0]!.toUpperCase();
        if (command === 'EHLO') socket.write('250-test\r\n250-AUTH LOGIN\r\n250 OK\r\n');
        else if (command === 'AUTH') socket.write('334 username\r\n');
        else if (command === 'DATA') {
          inData = true;
          socket.write('354 continue\r\n');
        } else if (command === 'QUIT') socket.write('221 bye\r\n');
        else if (/^[A-Za-z0-9+/=]+$/.test(line)) {
          authLines++;
          socket.write(authLines === 1 ? '334 password\r\n' : options.rejectPassword ? '535 denied\r\n' : '235 authenticated\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return { server, commands, body: () => body };
}

const rawMail = Buffer.from([
  'Message-ID: <mail-42@example.test>',
  'From: Ops <ops@example.test>',
  'To: Bot <bot@example.test>',
  'Subject: =?UTF-8?B?5bel5Y2V5oql6K2m?=',
  'Date: Thu, 31 Jul 2026 08:00:00 +0000',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'service is healthy',
].join('\r\n'));

function fakeImap(options: { password?: string; rejectLogin?: boolean } = {}): { server: Server; commands: string[] } {
  const commands: string[] = [];
  const server = createServer((socket: Socket) => {
    let input = '';
    socket.on('error', () => undefined);
    socket.write('* OK test IMAP ready\r\n');
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      let lineEnd = input.indexOf('\r\n');
      while (lineEnd >= 0) {
        const line = input.slice(0, lineEnd);
        input = input.slice(lineEnd + 2);
        lineEnd = input.indexOf('\r\n');
        if (!line) continue;
        commands.push(line);
        const [tag, command = '', ...parts] = line.split(' ');
        const rest = parts.join(' ');
        if (command.toUpperCase() === 'LOGIN') {
          socket.write(options.rejectLogin ? `${tag} NO login failed\r\n` : `${tag} OK logged in\r\n`);
        } else if (['SELECT', 'EXAMINE'].includes(command.toUpperCase())) {
          socket.write(`* 1 EXISTS\r\n${tag} OK selected\r\n`);
        } else if (command.toUpperCase() === 'UID' && rest.startsWith('SEARCH')) {
          const start = Number(rest.match(/UID (\d+):\*/)?.[1] ?? 1);
          socket.write(`* SEARCH${start <= 42 ? ' 42' : ''}\r\n${tag} OK search\r\n`);
        } else if (command.toUpperCase() === 'UID' && rest.startsWith('FETCH')) {
          socket.write(`* 1 FETCH (UID 42 BODY[] {${rawMail.byteLength}}\r\n`);
          socket.write(rawMail);
          socket.write(`\r\n)\r\n${tag} OK fetch\r\n`);
        } else if (command.toUpperCase() === 'UID' && rest.startsWith('STORE')) {
          socket.write(`${tag} OK stored\r\n`);
        } else if (command.toUpperCase() === 'LOGOUT') {
          socket.write(`* BYE closing\r\n${tag} OK logout\r\n`);
        } else socket.write(`${tag} BAD unsupported\r\n`);
      }
    });
  });
  void options.password;
  return { server, commands };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SSH 节点', () => {
  it('命令执行、上传、下载均复用单个安全连接', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'Linux\n', stderr: '', exitCode: 0, signal: null });
    const download = vi.fn().mockResolvedValue(Buffer.from('remote'));
    const upload = vi.fn().mockResolvedValue(undefined);
    const closeClient = vi.fn().mockResolvedValue(undefined);
    vi.mocked(connectSshClient).mockResolvedValue({ execute, download, upload, close: closeClient });

    const command = await new Ssh().execute.call(executeContext([{ json: { id: 1 } }], {
      authentication: 'password', resource: 'command', operation: 'execute', command: 'uname', cwd: '/tmp', timeout: 5000,
    }, { sshPassword: { host: 'server', username: 'bot', password: 'secret' } }));
    expect(command[0]![0]!.json).toMatchObject({ stdout: 'Linux\n', exitCode: 0 });
    expect(execute).toHaveBeenCalledWith('uname', '/tmp');

    await new Ssh().execute.call(executeContext([{ json: {}, binary: { data: binary('upload') } }], {
      authentication: 'privateKey', resource: 'file', operation: 'upload', path: '/tmp/in.txt', binaryPropertyName: 'data', timeout: 5000,
    }, { sshPrivateKey: { host: 'server', username: 'bot', privateKey: 'PRIVATE' } }));
    expect(upload).toHaveBeenCalledWith('/tmp/in.txt', Buffer.from('upload'));

    const downloaded = await new Ssh().execute.call(executeContext([{ json: {} }], {
      authentication: 'password', resource: 'file', operation: 'download', path: '/tmp/out.txt', binaryPropertyName: 'data', timeout: 5000,
    }, { sshPassword: { host: 'server', username: 'bot', password: 'secret' } }));
    expect(Buffer.from(downloaded[0]![0]!.binary!['data']!.data!, 'base64').toString()).toBe('remote');
    expect(closeClient).toHaveBeenCalledTimes(3);
  });

  it('连接错误不泄露密码或私钥', async () => {
    const secret = 'ssh-private-secret';
    vi.mocked(connectSshClient).mockRejectedValue(new Error(`bad ${secret}`));
    await expect(new Ssh().execute.call(executeContext([{ json: {} }], {
      authentication: 'privateKey', resource: 'command', operation: 'execute', command: 'id', timeout: 5000,
    }, { sshPrivateKey: { privateKey: secret } }))).rejects.toThrow('SSH connection failed');
    await expect(new Ssh().execute.call(executeContext([{ json: {} }], {
      authentication: 'privateKey', resource: 'command', operation: 'execute', command: 'id', timeout: 5000,
    }, { sshPrivateKey: { privateKey: secret } }))).rejects.not.toThrow(secret);
  });
});

describe('Send Email 节点', () => {
  it('经真实 SMTP 协议投递文本并返回 messageId', async () => {
    const smtp = fakeSmtp();
    const port = await listen(smtp.server);
    try {
      const result = await new SendEmail().execute.call(executeContext([{ json: { ticket: 7 } }], {
        fromEmail: 'Nomops <bot@example.test>', toEmail: 'ops@example.test', subject: '告警', contentType: 'text', text: '.line',
      }, { smtp: { host: '127.0.0.1', port, secure: false, user: 'bot', password: 'smtp-secret' } }));
      expect(result[0]![0]!.json['accepted']).toEqual(['ops@example.test']);
      expect(result[0]![0]!.json['messageId']).toBeTruthy();
      expect(smtp.body()).toContain('..line');
      expect(smtp.commands).toContain('MAIL FROM:<bot@example.test>');
    } finally {
      await close(smtp.server);
    }
  });

  it('认证失败不在错误中泄露密码或其 Base64', async () => {
    const smtp = fakeSmtp({ rejectPassword: true });
    const port = await listen(smtp.server);
    const secret = 'smtp-secret-value';
    try {
      await expect(sendSmtpMail({ host: '127.0.0.1', port, secure: false, user: 'bot', password: secret }, {
        from: 'bot@example.test', to: 'ops@example.test', subject: 'x', text: 'y',
      })).rejects.toThrow('SMTP AUTH password failed');
      await expect(sendSmtpMail({ host: '127.0.0.1', port, secure: false, user: 'bot', password: secret }, {
        from: 'bot@example.test', to: 'ops@example.test', subject: 'x', text: 'y',
      })).rejects.not.toThrow(new RegExp(`${secret}|${Buffer.from(secret).toString('base64')}`));
    } finally {
      await close(smtp.server);
    }
  });
});

describe('Email Trigger (IMAP)', () => {
  it('轮询新 UID、解析邮件并持久推进游标', async () => {
    const imap = fakeImap();
    const port = await listen(imap.server);
    const state: JsonObject = {};
    const seen = new Set<string>();
    const context: IPollContext = {
      getNodeParameter: (name) => ({ mailbox: 'INBOX', postProcessAction: 'read', format: 'simple', timeout: 5000 } as JsonObject)[name],
      getCredentials: async () => ({ host: '127.0.0.1', port, secure: false, user: 'bot', password: 'imap-secret' }),
      getWorkflowStaticData: () => state,
      helpers: {
        httpRequest: async () => ({}),
        filterNewKeys: async (keys) => keys.filter((key) => !seen.has(key) && Boolean(seen.add(key))),
      },
    };
    try {
      const first = await new EmailTrigger().poll.call(context);
      expect(first?.[0]?.[0]?.json).toMatchObject({ uid: 42, subject: '工单报警', text: 'service is healthy' });
      expect(state['lastUid']).toBe(42);
      expect(imap.commands.some((command) => command.includes('UID STORE 42'))).toBe(true);
      expect(await new EmailTrigger().poll.call(context)).toBeNull();
    } finally {
      await close(imap.server);
    }
  });

  it('登录失败不泄露 IMAP 密码', async () => {
    const imap = fakeImap({ rejectLogin: true });
    const port = await listen(imap.server);
    const secret = 'imap-secret-value';
    const context: IPollContext = {
      getNodeParameter: () => 5000,
      getCredentials: async () => ({ host: '127.0.0.1', port, secure: false, user: 'bot', password: secret }),
      getWorkflowStaticData: () => ({}),
      helpers: { httpRequest: async () => ({}), filterNewKeys: async (keys) => keys },
    };
    try {
      await expect(new EmailTrigger().poll.call(context)).rejects.toThrow('IMAP LOGIN failed');
      await expect(new EmailTrigger().poll.call(context)).rejects.not.toThrow(secret);
    } finally {
      await close(imap.server);
    }
  });
});
