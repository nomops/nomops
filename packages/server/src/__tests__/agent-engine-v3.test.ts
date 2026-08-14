import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { IHttpRequestOptions } from '@nomops/workflow';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';

let boot: BootstrapResult;
let app: Express;
let token: string;
let modelCalls = 0;
let toolCalls = 0;

const fakeHttp = async (options: IHttpRequestOptions): Promise<unknown> => {
  if (options.url === 'https://tool.test/lookup') {
    toolCalls++;
    return { value: 42 };
  }
  modelCalls++;
  if (modelCalls === 1) {
    return {
      content: [
        { type: 'tool_use', id: 'call-live-1', name: 'lookup', input: { id: 41 } },
        { type: 'tool_use', id: 'call-live-2', name: 'lookup', input: { id: 42 } },
      ],
      usage: { input_tokens: 10, output_tokens: 4 },
    };
  }
  return {
    content: [{ type: 'text', text: 'The answer is 42.' }],
    usage: { input_tokens: 8, output_tokens: 5 },
  };
};

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: fakeHttp });
  app = createApp(boot.services);
  await request(app)
    .post('/auth/register')
    .send({ email: 'agent-v3@test.dev', password: 'password-123' })
    .expect(201);
  token = (
    await request(app)
      .post('/auth/login')
      .send({ email: 'agent-v3@test.dev', password: 'password-123' })
      .expect(200)
  ).body.token as string;
});

afterAll(async () => {
  await boot?.shutdown();
});

const authed = () => ({ Authorization: `Bearer ${token}` });

describe('Agent V3 服务端全链', () => {
  it('画布 Agent 工具先 HITL waiting，resume 后执行并在详情逐调用可见', async () => {
    const credential = (
      await request(app)
        .post('/api/credentials')
        .set(authed())
        .send({ name: 'Agent V3 Model', type: 'anthropicApi', data: { apiKey: 'test-key' } })
        .expect(201)
    ).body;
    const workflow = (
      await request(app)
        .post('/api/workflows')
        .set(authed())
        .send({
          name: 'Agent V3 HITL',
          nodes: [
            { id: 'start', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
            { id: 'agent', name: 'Agent', type: 'nomops.aiAgent', typeVersion: 1, position: [240, 0], parameters: { text: 'Find 42' } },
            {
              id: 'model',
              name: 'Model',
              type: 'nomops.chatModel',
              typeVersion: 1,
              position: [240, 180],
              parameters: { provider: 'anthropic', model: 'claude-sonnet-5' },
              credentials: { anthropicApi: { id: credential.id, name: credential.name } },
            },
            {
              id: 'tool',
              name: 'Lookup Tool',
              type: 'nomops.httpTool',
              typeVersion: 1,
              position: [480, 180],
              parameters: {
                toolName: 'lookup',
                toolDescription: 'Look up an id',
                requireApproval: true,
                url: 'https://tool.test/lookup',
                method: 'GET',
              },
            },
          ],
          connections: {
            Start: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
            Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
            'Lookup Tool': { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] },
          },
        })
        .expect(201)
    ).body;

    const first = await request(app)
      .post(`/api/workflows/${workflow.id}/run`)
      .set(authed())
      .send({})
      .expect(200);
    expect(first.body.status).toBe('waiting');
    expect(toolCalls).toBe(0);

    const resumedOnce = await request(app)
      .post(`/api/executions/${first.body.executionId}/resume`)
      .set(authed())
      .send({})
      .expect(200);
    expect(resumedOnce.body.status).toBe('waiting');
    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(1);

    const resumed = await request(app)
      .post(`/api/executions/${first.body.executionId}/resume`)
      .set(authed())
      .send({})
      .expect(200);
    expect(resumed.body.status).toBe('success');
    expect(modelCalls).toBe(2);
    expect(toolCalls).toBe(2);

    const detail = await request(app)
      .get(`/api/executions/${first.body.executionId}`)
      .set(authed())
      .expect(200);
    const runData = detail.body.data.resultData.runData;
    expect(runData['Lookup Tool']).toHaveLength(2);
    expect(runData['Lookup Tool'][0]).toMatchObject({
      data: { ai_tool: [[{ json: { result: '{"value":42}' } }]] },
      metadata: {
        agentToolCall: {
          callId: 'call-live-1',
          toolName: 'lookup',
          parentNodeName: 'Agent',
        },
      },
    });
    expect(runData['Lookup Tool'][1].metadata.agentToolCall).toMatchObject({
      callId: 'call-live-2',
      toolName: 'lookup',
      parentNodeName: 'Agent',
    });
    expect(runData.Agent[0].data.main[0][0].json).toMatchObject({
      output: 'The answer is 42.',
      toolRounds: 1,
      _nmUsage: { inputTokens: 18, outputTokens: 9 },
    });
  });
});
