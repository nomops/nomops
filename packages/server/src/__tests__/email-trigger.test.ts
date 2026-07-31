import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

const rawMail = Buffer.from([
  'Message-ID: <imap-live-77@example.test>',
  'From: Monitor <monitor@example.test>',
  'To: Robot <robot@example.test>',
  'Subject: IMAP integration',
  'Date: Thu, 31 Jul 2026 08:00:00 +0000',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'new incident',
].join('\r\n'));

function fakeImapServer(): Server {
  return createServer((socket: Socket) => {
    let input = '';
    socket.on('error', () => undefined);
    socket.write('* OK integration IMAP ready\r\n');
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      let end = input.indexOf('\r\n');
      while (end >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        end = input.indexOf('\r\n');
        if (!line) continue;
        const [tag, command = '', ...parts] = line.split(' ');
        const rest = parts.join(' ');
        if (command.toUpperCase() === 'LOGIN') socket.write(`${tag} OK login\r\n`);
        else if (['SELECT', 'EXAMINE'].includes(command.toUpperCase())) socket.write(`* 1 EXISTS\r\n${tag} OK selected\r\n`);
        else if (command.toUpperCase() === 'UID' && rest.startsWith('SEARCH')) {
          const start = Number(rest.match(/UID (\d+):\*/)?.[1] ?? 1);
          socket.write(`* SEARCH${start <= 77 ? ' 77' : ''}\r\n${tag} OK search\r\n`);
        } else if (command.toUpperCase() === 'UID' && rest.startsWith('FETCH')) {
          socket.write(`* 1 FETCH (UID 77 BODY[] {${rawMail.byteLength}}\r\n`);
          socket.write(rawMail);
          socket.write(`\r\n)\r\n${tag} OK fetch\r\n`);
        } else if (command.toUpperCase() === 'UID' && rest.startsWith('STORE')) socket.write(`${tag} OK stored\r\n`);
        else if (command.toUpperCase() === 'LOGOUT') socket.write(`* BYE\r\n${tag} OK logout\r\n`);
        else socket.write(`${tag} BAD unsupported\r\n`);
      }
    });
  });
}

let boot: BootstrapResult;
let app: Express;
let token: string;
let imap: Server;
let imapPort: number;

beforeAll(async () => {
  imap = fakeImapServer();
  await new Promise<void>((resolve) => imap.listen(0, '127.0.0.1', resolve));
  imapPort = (imap.address() as { port: number }).port;
  boot = await bootstrap({ type: 'sqlite' });
  await boot.leader.start();
  app = createApp(boot.services);
  const registration = await request(app).post('/auth/register').send({ email: 'imap@test.dev', password: 'password-123' }).expect(201);
  token = registration.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
  await new Promise<void>((resolve) => imap.close(() => resolve()));
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('Email Trigger (IMAP) 端到端', () => {
  it('解密 project 凭证轮询新邮件并启动工作流，明文不出 API/不落库', async () => {
    const secret = 'imap-project-secret';
    const credential = await request(app).post('/api/credentials').set(authed()).send({
      name: 'Inbox',
      type: 'imap',
      data: { host: '127.0.0.1', port: imapPort, secure: false, user: 'robot', password: secret },
    }).expect(201);
    expect(JSON.stringify(credential.body)).not.toContain(secret);
    const me = await request(app).get('/api/me').set(authed()).expect(200);
    const stored = await boot.services.repos.credentials.findById(credential.body.id as string, me.body.projectId as string);
    expect(stored?.data).not.toContain(secret);

    const workflow = await request(app).post('/api/workflows').set(authed()).send({
      name: 'imap-trigger-flow',
      nodes: [
        {
          id: 'a', name: 'Inbox', type: 'nomops.emailTrigger', typeVersion: 1, position: [0, 0],
          parameters: { mailbox: 'INBOX', postProcessAction: 'read', format: 'simple', pollInterval: 3600, timeout: 5000 },
          credentials: { imap: { id: credential.body.id, name: 'Inbox' } },
        },
        { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [200, 0], parameters: { fields: { received: true } } },
      ],
      connections: { Inbox: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } },
    }).expect(201);

    await request(app).post(`/api/workflows/${workflow.body.id}/activate`).set(authed()).send({ active: true }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const executions = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ id: string; workflowId: string }>;
    const run = executions.find((execution) => execution.workflowId === workflow.body.id);
    expect(run).toBeTruthy();
    const detail = await request(app).get(`/api/executions/${run!.id}`).set(authed()).expect(200);
    expect(detail.body.data.resultData.runData['Inbox'][0].data.main[0][0].json).toMatchObject({
      uid: 77,
      subject: 'IMAP integration',
      text: 'new incident',
    });
    expect(JSON.stringify(detail.body)).not.toContain(secret);

    await boot.services.activeWorkflows.pollOnce(workflow.body.id as string);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const after = (await request(app).get('/api/executions').set(authed()).expect(200)).body as Array<{ workflowId: string }>;
    expect(after.filter((execution) => execution.workflowId === workflow.body.id)).toHaveLength(1);
    await request(app).post(`/api/workflows/${workflow.body.id}/activate`).set(authed()).send({ active: false }).expect(200);
  });
});
