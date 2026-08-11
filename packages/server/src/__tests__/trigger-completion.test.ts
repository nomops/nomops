import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { defaultHttpRequest, defaultOpenEventStream } from '@nomops/core';
import type { IEventStreamMessage, IEventStreamOptions, IHttpRequestOptions } from '@nomops/workflow';

let boot: BootstrapResult;
let app: Express;
let token: string;
let upstream: Server;
let baseUrl: string;
let feedEntries = [{ id: 'feed-1', title: 'First item' }];
const eventClients = new Set<ServerResponse>();

const auth = () => ({ Authorization: `Bearer ${token}` });
const wait = (milliseconds = 120) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const trustedLocalRequest = (options: IHttpRequestOptions) =>
  defaultHttpRequest({ ...options, urlTrust: 'trusted' });
const trustedLocalEventStream = (
  options: IEventStreamOptions,
  onMessage: (message: IEventStreamMessage) => void,
) => defaultOpenEventStream({ ...options, urlTrust: 'trusted' }, onMessage);

function feedXml(): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Live Feed</title>${feedEntries
    .map((entry) => `<item><guid>${entry.id}</guid><title>${entry.title}</title><link>https://example.test/${entry.id}</link></item>`)
    .join('')}</channel></rss>`;
}

async function createWorkflow(body: Record<string, unknown>): Promise<string> {
  const response = await request(app).post('/api/workflows').set(auth()).send(body).expect(201);
  return response.body.id as string;
}

async function executionsFor(workflowId: string): Promise<Array<{ id: string; status: string }>> {
  const response = await request(app).get('/api/executions').set(auth()).expect(200);
  return (response.body as Array<{ id: string; workflowId: string; status: string }>).filter(
    (execution) => execution.workflowId === workflowId,
  );
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.flushHeaders();
      eventClients.add(res);
      req.on('close', () => eventClients.delete(res));
      return;
    }
    if (req.url === '/feed') {
      res.setHeader('content-type', 'application/rss+xml');
      res.end(feedXml());
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    httpRequest: trustedLocalRequest,
    openEventStream: trustedLocalEventStream,
  });
  await boot.leader.start();
  app = createApp(boot.services);
  const registration = await request(app)
    .post('/auth/register')
    .send({ email: 'trigger-completion@test.dev', password: 'password-123' })
    .expect(201);
  token = registration.body.token as string;
});

afterAll(async () => {
  await boot.shutdown();
  for (const client of eventClients) client.end();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe('触发器补全五件套端到端', () => {
  it('Form Trigger multipart 上传把文件元数据和 binary 引用一起送入执行', async () => {
    const workflowId = await createWorkflow({
      name: 'public-upload-flow',
      nodes: [{
        id: 'a', name: 'Upload Form', type: 'nomops.formTrigger', typeVersion: 1, position: [0, 0],
        parameters: {
          path: 'public-upload-live', formTitle: 'Upload', formDescription: '',
          formFields: { values: [{
            fieldLabel: 'Document', fieldName: 'document', fieldType: 'file', requiredField: true,
            acceptFileTypes: 'text/plain', multipleFiles: false,
          }] },
        },
      }],
      connections: {},
    });
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: true }).expect(200);
    const page = await request(app).get('/webhook/public-upload-live').expect(200);
    expect(page.text).toContain('enctype="multipart/form-data"');

    await request(app)
      .post('/webhook/public-upload-live')
      .attach('document', Buffer.from('UPLOAD-BYTES'), { filename: 'note.txt', contentType: 'text/plain' })
      .expect(200);
    const executions = await executionsFor(workflowId);
    expect(executions).toHaveLength(1);
    const detail = await request(app).get(`/api/executions/${executions[0]!.id}`).set(auth()).expect(200);
    const item = detail.body.data.resultData.runData['Upload Form'][0].data.main[0][0];
    expect(item.json.document).toEqual({ filename: 'note.txt', mimetype: 'text/plain', size: 12 });
    expect(item.binary.document).toMatchObject({ mimeType: 'text/plain', fileName: 'note.txt', fileSize: 12 });
    expect(Buffer.from(await boot.services.executions.getBinaryStore()!.get(item.binary.document.id)).toString()).toBe('UPLOAD-BYTES');
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: false }).expect(200);
  });

  it('Form Trigger GET 公开页不执行，POST 提交启动工作流并携带类型化数据', async () => {
    const workflowId = await createWorkflow({
      name: 'public-form-flow',
      nodes: [
        {
          id: 'a', name: 'Public Form', type: 'nomops.formTrigger', typeVersion: 1, position: [0, 0],
          parameters: {
            path: 'public-form-live', formTitle: '<Public Form>', formDescription: 'Tell us more', submitLabel: 'Send',
            fields: { values: [
              { name: 'email', label: 'Email', type: 'email', required: true, placeholder: '', options: '' },
              { name: 'score', label: 'Score', type: 'number', required: true, placeholder: '', options: '' },
            ] },
          },
        },
        { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [240, 0], parameters: { fields: { accepted: true } } },
      ],
      connections: { 'Public Form': { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: true }).expect(200);

    const page = await request(app).get('/webhook/public-form-live').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.text).toContain('&lt;Public Form&gt;');
    expect(await executionsFor(workflowId)).toHaveLength(0);

    await request(app)
      .post('/webhook/public-form-live')
      .type('form')
      .send({ email: 'person@example.com', score: '9' })
      .expect(200)
      .expect('content-type', /text\/html/);
    const executions = await executionsFor(workflowId);
    expect(executions).toHaveLength(1);
    const detail = await request(app).get(`/api/executions/${executions[0]!.id}`).set(auth()).expect(200);
    expect(detail.body.data.resultData.runData['Public Form'][0].data.main[0][0].json).toEqual({
      email: 'person@example.com', score: 9,
    });
    expect(detail.body.data.resultData.runData['Tag'][0].data.main[0][0].json).toMatchObject({ accepted: true, score: 9 });
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: false }).expect(200);
  });

  it('Form 在流程中挂起，公开页提交后以原 execution 续跑', async () => {
    const workflowId = await createWorkflow({
      name: 'waiting-form-flow',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        {
          id: 'b', name: 'Review Form', type: 'nomops.form', typeVersion: 1, position: [220, 0],
          parameters: {
            formTitle: 'Review', formDescription: 'Choose a decision', submitLabel: 'Continue',
            fields: { values: [{ name: 'decision', label: 'Decision', type: 'select', required: true, placeholder: '', options: 'approve, reject' }] },
          },
        },
        { id: 'c', name: 'Done', type: 'nomops.set', typeVersion: 1, position: [440, 0], parameters: { fields: { completed: true } } },
      ],
      connections: {
        Start: { main: [[{ node: 'Review Form', type: 'main', index: 0 }]] },
        'Review Form': { main: [[{ node: 'Done', type: 'main', index: 0 }]] },
      },
    });
    const run = await request(app).post(`/api/workflows/${workflowId}/run`).set(auth()).send({}).expect(200);
    expect(run.body.status).toBe('waiting');
    const state = await boot.services.repos.executions.getData(run.body.executionId as string);
    const resumeUrl = `/webhook-waiting/${run.body.executionId}/${String(state?.['resumeToken'])}`;
    const page = await request(app).get(resumeUrl).expect(200);
    expect(page.text).toContain('Review');
    expect((await boot.services.repos.executions.getRecord(run.body.executionId as string))?.status).toBe('waiting');

    await request(app).post(resumeUrl).type('form').send({ decision: 'approve' }).expect(200);
    const detail = await request(app).get(`/api/executions/${run.body.executionId}`).set(auth()).expect(200);
    expect((await boot.services.repos.executions.getRecord(run.body.executionId as string))?.status).toBe('success');
    expect(detail.body.data.resultData.runData['Review Form'][0].data.main[0][0].json).toEqual({ decision: 'approve' });
    expect(detail.body.data.resultData.runData['Done'][0].data.main[0][0].json).toEqual({ decision: 'approve', completed: true });
    expect(() => JSON.stringify(detail.body.data)).not.toThrow();
  });

  it('RSS Read 真实拉取 feed，RSS Feed Trigger 只为新增条目启动执行', async () => {
    feedEntries = [{ id: 'feed-1', title: 'First item' }];
    const readId = await createWorkflow({
      name: 'rss-read-flow',
      nodes: [
        { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'Read Feed', type: 'nomops.rssFeedRead', typeVersion: 1, position: [220, 0], parameters: { url: `${baseUrl}/feed` } },
      ],
      connections: { Start: { main: [[{ node: 'Read Feed', type: 'main', index: 0 }]] } },
    });
    const read = await request(app).post(`/api/workflows/${readId}/run`).set(auth()).send({}).expect(200);
    const readDetail = await request(app).get(`/api/executions/${read.body.executionId}`).set(auth()).expect(200);
    expect(readDetail.body.data.resultData.runData['Read Feed'][0].data.main[0][0].json.guid).toBe('feed-1');

    const triggerId = await createWorkflow({
      name: 'rss-trigger-flow',
      nodes: [
        { id: 'a', name: 'Feed', type: 'nomops.rssFeedReadTrigger', typeVersion: 1, position: [0, 0], parameters: { url: `${baseUrl}/feed`, pollInterval: 3600 } },
        { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [220, 0], parameters: { fields: { fresh: true } } },
      ],
      connections: { Feed: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${triggerId}/activate`).set(auth()).send({ active: true }).expect(200);
    await wait();
    expect(await executionsFor(triggerId)).toHaveLength(1);
    await boot.services.activeWorkflows.pollOnce(triggerId);
    await wait(80);
    expect(await executionsFor(triggerId)).toHaveLength(1);
    feedEntries.push({ id: 'feed-2', title: 'Second item' });
    await boot.services.activeWorkflows.pollOnce(triggerId);
    await wait();
    const executions = await executionsFor(triggerId);
    expect(executions).toHaveLength(2);
    const outputs = await Promise.all(executions.map(async (execution) => {
      const detail = await request(app).get(`/api/executions/${execution.id}`).set(auth()).expect(200);
      return detail.body.data.resultData.runData['Feed'][0].data.main[0].map((item: { json: { guid: string } }) => item.json.guid);
    }));
    expect(outputs).toContainEqual(['feed-2']);
    await request(app).post(`/api/workflows/${triggerId}/activate`).set(auth()).send({ active: false }).expect(200);
  });

  it('SSE Trigger 建立真实长连接并为收到的事件启动工作流', async () => {
    const workflowId = await createWorkflow({
      name: 'sse-trigger-flow',
      nodes: [
        { id: 'a', name: 'Events', type: 'nomops.sseTrigger', typeVersion: 1, position: [0, 0], parameters: { url: `${baseUrl}/events`, eventName: 'update', headers: {} } },
        { id: 'b', name: 'Tag', type: 'nomops.set', typeVersion: 1, position: [220, 0], parameters: { fields: { streamed: true } } },
      ],
      connections: { Events: { main: [[{ node: 'Tag', type: 'main', index: 0 }]] } },
    });
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: true }).expect(200);
    expect(eventClients.size).toBeGreaterThan(0);
    for (const client of eventClients) client.write('id: live-1\nevent: update\ndata: {"value":42}\n\n');
    await wait(180);
    const executions = await executionsFor(workflowId);
    expect(executions).toHaveLength(1);
    const detail = await request(app).get(`/api/executions/${executions[0]!.id}`).set(auth()).expect(200);
    expect(detail.body.data.resultData.runData['Events'][0].data.main[0][0].json).toEqual({
      value: 42, _event: 'update', _eventId: 'live-1',
    });
    expect(detail.body.data.resultData.runData['Tag'][0].data.main[0][0].json).toMatchObject({ streamed: true, value: 42 });
    await request(app).post(`/api/workflows/${workflowId}/activate`).set(auth()).send({ active: false }).expect(200);
  });
});
