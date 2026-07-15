import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner, inviteUser } from './helpers.js';
import type {
  CredentialTestRequest,
  CredentialTestResponse,
  ICredentialTester,
} from '../services/credential-test.js';

/**
 * 凭证连接测试（对标 n8n Test connection）：按类型打服务端点，默认看 HTTP 状态；
 * slack/graphql 走 body 级判定。假 HTTP 客户端不打真网，并记录请求以断言
 * 「密钥进了请求、但绝不回 API」（铁律 3）。
 */

class FakeTester implements ICredentialTester {
  lastReq?: CredentialTestRequest;
  next: CredentialTestResponse = { status: 200, ok: true };
  async request(req: CredentialTestRequest) {
    this.lastReq = req;
    return this.next;
  }
}

let boot: BootstrapResult;
let app: Express;
let owner: string;
const tester = new FakeTester();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const createCred = (token: string, type: string, data: Record<string, unknown>) =>
  request(app).post('/api/credentials').set(bearer(token)).send({ name: `${type} cred`, type, data }).expect(201);
const testCred = (token: string, id: string) => request(app).post(`/api/credentials/${id}/test`).set(bearer(token));

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, credentialTester: tester });
  app = createApp(boot.services);
  owner = (await setupOwner(app, 'owner@cred.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('可测类型', () => {
  it('成功：打对端点、带上密钥，返回 ok；密钥不回 API', async () => {
    const gh = await createCred(owner, 'githubApi', { accessToken: 'ghp_secret123' });
    tester.next = { status: 200, ok: true };
    const res = await testCred(owner, gh.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: true, tested: true });
    // 请求确实带了解密后的密钥打向 GitHub
    expect(tester.lastReq?.url).toBe('https://api.github.com/user');
    expect(tester.lastReq?.headers?.authorization).toBe('Bearer ghp_secret123');
    // 但响应绝不含密钥（铁律 3）
    expect(JSON.stringify(res.body)).not.toContain('ghp_secret123');
  });

  it('失败：服务返回 401 → ok:false，消息含状态码', async () => {
    const gh = await createCred(owner, 'githubApi', { accessToken: 'bad-token' });
    tester.next = { status: 401, ok: false };
    const res = await testCred(owner, gh.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('401');
  });

  it('网络错误 → ok:false，tested:true', async () => {
    const gh = await createCred(owner, 'openAiApi', { apiKey: 'sk-x' });
    const orig = tester.request.bind(tester);
    tester.request = async () => {
      throw new Error('ENOTFOUND');
    };
    const res = await testCred(owner, gh.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('ENOTFOUND');
    tester.request = orig;
  });
});

describe('body 级判定：Slack（auth.test 恒 200）', () => {
  it('body.ok=true → ok；请求打 auth.test 带 Bearer', async () => {
    const slack = await createCred(owner, 'slackApi', { accessToken: 'xoxb-good' });
    tester.next = { status: 200, ok: true, json: { ok: true, team: 'acme' } };
    const res = await testCred(owner, slack.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: true, tested: true });
    expect(tester.lastReq?.url).toBe('https://slack.com/api/auth.test');
    expect(tester.lastReq?.headers?.authorization).toBe('Bearer xoxb-good');
    expect(tester.lastReq?.bodyCheck).toBe('slack');
  });

  it('HTTP 200 但 body.ok=false → 失败，消息含错误码、不透传其余 body', async () => {
    const slack = await createCred(owner, 'slackApi', { accessToken: 'xoxb-bad' });
    tester.next = { status: 200, ok: true, json: { ok: false, error: 'invalid_auth', team: 'leak-me-not' } };
    const res = await testCred(owner, slack.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('invalid_auth');
    // 只透出错误码，不整体回传响应 body
    expect(JSON.stringify(res.body)).not.toContain('leak-me-not');
    expect(JSON.stringify(res.body)).not.toContain('xoxb-bad');
  });
});

describe('body 级判定：GraphQL（Linear，200 + errors）', () => {
  it('data 且无 errors → ok；请求是 POST + query body', async () => {
    const linear = await createCred(owner, 'linearApi', { apiKey: 'lin_good' });
    tester.next = { status: 200, ok: true, json: { data: { viewer: { id: 'u1' } } } };
    const res = await testCred(owner, linear.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: true, tested: true });
    expect(tester.lastReq?.method).toBe('POST');
    expect(tester.lastReq?.url).toBe('https://api.linear.app/graphql');
    expect(tester.lastReq?.body).toContain('viewer');
    expect(tester.lastReq?.bodyCheck).toBe('graphql');
  });

  it('HTTP 200 但 errors 数组 → 失败，消息含首条错误', async () => {
    const linear = await createCred(owner, 'linearApi', { apiKey: 'lin_bad' });
    tester.next = { status: 200, ok: true, json: { errors: [{ message: 'Authentication required' }] } };
    const res = await testCred(owner, linear.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('Authentication required');
  });

  it('GraphQL 非 200（如 400）→ 失败，消息含状态码', async () => {
    const linear = await createCred(owner, 'linearApi', { apiKey: 'lin_x' });
    tester.next = { status: 400, ok: false };
    const res = await testCred(owner, linear.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('400');
  });
});

describe('Basic-auth 拼接型：Jira / Zendesk / Freshdesk / Twilio / Mailchimp', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  it('jira：email:apiToken → Basic；domain 容忍全 URL/尾斜杠', async () => {
    const jira = await createCred(owner, 'jiraApi', {
      domain: 'https://acme.atlassian.net/',
      email: 'me@acme.dev',
      apiToken: 'jira-tok',
    });
    tester.next = { status: 200, ok: true };
    const res = await testCred(owner, jira.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: true, tested: true });
    expect(tester.lastReq?.url).toBe('https://acme.atlassian.net/rest/api/2/myself');
    expect(tester.lastReq?.headers?.authorization).toBe(`Basic ${b64('me@acme.dev:jira-tok')}`);
  });

  it('jira：裸主机名（无协议）同样归一化；401 → 失败', async () => {
    const jira = await createCred(owner, 'jiraApi', { domain: 'acme.atlassian.net', email: 'me@acme.dev', apiToken: 'bad' });
    tester.next = { status: 401, ok: false };
    const res = await testCred(owner, jira.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: true });
    expect(res.body.message).toContain('401');
    expect(tester.lastReq?.url).toBe('https://acme.atlassian.net/rest/api/2/myself');
  });

  it('zendesk：user 拼 {email}/token；subdomain 容忍贴全域名', async () => {
    const zd = await createCred(owner, 'zendeskApi', {
      subdomain: 'acme.zendesk.com',
      email: 'me@acme.dev',
      apiToken: 'zd-tok',
    });
    tester.next = { status: 200, ok: true };
    const res = await testCred(owner, zd.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: true, tested: true });
    expect(tester.lastReq?.url).toBe('https://acme.zendesk.com/api/v2/users/me.json');
    expect(tester.lastReq?.headers?.authorization).toBe(`Basic ${b64('me@acme.dev/token:zd-tok')}`);
  });

  it('freshdesk：apiKey:X → Basic', async () => {
    const fd = await createCred(owner, 'freshdeskApi', { domain: 'acme', apiKey: 'fd-key' });
    tester.next = { status: 200, ok: true };
    await testCred(owner, fd.body.id).expect(200);
    expect(tester.lastReq?.url).toBe('https://acme.freshdesk.com/api/v2/agents/me');
    expect(tester.lastReq?.headers?.authorization).toBe(`Basic ${b64('fd-key:X')}`);
  });

  it('twilio：sid:authToken → Basic，sid 进 URL；非法 SID → 缺字段不发请求', async () => {
    const tw = await createCred(owner, 'twilioApi', { accountSid: 'AC12345abc', authToken: 'tw-tok' });
    tester.next = { status: 200, ok: true };
    await testCred(owner, tw.body.id).expect(200);
    expect(tester.lastReq?.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC12345abc.json');
    expect(tester.lastReq?.headers?.authorization).toBe(`Basic ${b64('AC12345abc:tw-tok')}`);

    tester.lastReq = undefined;
    const bad = await createCred(owner, 'twilioApi', { accountSid: 'AC../evil', authToken: 't' });
    const res = await testCred(owner, bad.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: false });
    expect(tester.lastReq).toBeUndefined(); // 非法输入未拼进 URL
  });

  it('mailchimp：从 key 后缀取 dc 拼域名；无 dc 后缀 → 缺字段', async () => {
    const mc = await createCred(owner, 'mailchimpApi', { apiKey: 'abc123-us21' });
    tester.next = { status: 200, ok: true };
    await testCred(owner, mc.body.id).expect(200);
    expect(tester.lastReq?.url).toBe('https://us21.api.mailchimp.com/3.0/');
    expect(tester.lastReq?.headers?.authorization).toBe(`Basic ${b64('anystring:abc123-us21')}`);

    tester.lastReq = undefined;
    const noDc = await createCred(owner, 'mailchimpApi', { apiKey: 'no-suffix-here' });
    const res = await testCred(owner, noDc.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: false });
    expect(tester.lastReq).toBeUndefined();
  });

  it('jira 域名含非法字符 → 缺字段不发请求（不拼进 URL）', async () => {
    const jira = await createCred(owner, 'jiraApi', { domain: 'acme..net/../x y', email: 'a@b.c', apiToken: 't' });
    tester.lastReq = undefined;
    const res = await testCred(owner, jira.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: false });
    expect(tester.lastReq).toBeUndefined();
  });
});

describe('不可测 / 缺字段', () => {
  it('无连接测试的类型 → tested:false，ok:true', async () => {
    const hh = await createCred(owner, 'httpHeaderAuth', { name: 'X-API-Key', value: 'v' });
    const res = await testCred(owner, hh.body.id).expect(200);
    expect(res.body).toEqual({ ok: true, tested: false, message: expect.stringContaining('No connection test') });
  });

  it('可测类型但缺必填字段 → tested:false，ok:false', async () => {
    const gh = await createCred(owner, 'githubApi', { accessToken: '' });
    const res = await testCred(owner, gh.body.id).expect(200);
    expect(res.body).toMatchObject({ ok: false, tested: false });
    expect(res.body.message).toContain('Missing fields');
  });
});

describe('归属', () => {
  it('别的用户测不了我的凭证 → 404', async () => {
    const gh = await createCred(owner, 'githubApi', { accessToken: 'ghp_x' });
    const other = (await inviteUser(app, owner, 'other@cred.dev')).token;
    await testCred(other, gh.body.id).expect(404);
  });
});
