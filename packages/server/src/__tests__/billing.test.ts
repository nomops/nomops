import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { AlipayProvider, buildSignContent, signRsa2 } from '../billing/alipay-provider.js';
import { orderAmount } from '../billing/billing-service.js';

/**
 * 支付宝集成验收：RSA2 协议层自验（自造密钥对，appKeys=我方、alipayKeys=模拟支付宝侧）+
 * 下单→通知→派发全链路 + 幂等/篡改/金额核对 + 配额过期回落。
 */

// 我方应用密钥对 + “支付宝侧”密钥对
const appKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const alipayKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k: typeof appKeys.privateKey) => k.export({ type: 'pkcs8', format: 'pem' }) as string;
const pubPem = (k: typeof appKeys.publicKey) => k.export({ type: 'spki', format: 'pem' }) as string;

const APP_ID = '2021000000000001';

const alipay = new AlipayProvider({
  appId: APP_ID,
  appPrivateKey: pem(appKeys.privateKey),
  alipayPublicKey: pubPem(alipayKeys.publicKey),
  gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  notifyUrl: 'https://nomops.example.com/billing/alipay/notify',
});

/** 模拟支付宝签发一条异步通知（form-encoded + RSA2 签名）。 */
function signedNotify(fields: Record<string, string>): string {
  const params: Record<string, string> = {
    app_id: APP_ID,
    trade_status: 'TRADE_SUCCESS',
    charset: 'utf-8',
    sign_type: 'RSA2',
    ...fields,
  };
  params['sign'] = signRsa2(buildSignContent(params), pem(alipayKeys.privateKey));
  return new URLSearchParams(params).toString();
}

let boot: BootstrapResult;
let app: Express;
let token: string;
let projectId: string;

const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: 'test-ent', alipay });
  app = createApp(boot.services);
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: 'pay@dev.dev', password: 'password-123' })
    .expect(201);
  token = reg.body.token;
  projectId = reg.body.projectId;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('协议层（RSA2）', () => {
  it('收银台 URL：网关正确、含 RSA2 签名、biz_content 完整', () => {
    const url = new URL(
      alipay.buildPagePayUrl({ id: 'order-1', amount: '99.00', subject: 'nomops Pro × 1 个月' }),
    );
    expect(url.origin + url.pathname).toBe('https://openapi-sandbox.dl.alipaydev.com/gateway.do');
    expect(url.searchParams.get('method')).toBe('alipay.trade.page.pay');
    expect(url.searchParams.get('sign_type')).toBe('RSA2');
    expect(url.searchParams.get('sign')).toBeTruthy();
    const biz = JSON.parse(url.searchParams.get('biz_content')!);
    expect(biz).toMatchObject({ out_trade_no: 'order-1', total_amount: '99.00', product_code: 'FAST_INSTANT_TRADE_PAY' });
  });

  it('通知验签：合法通过；篡改金额被拒；错密钥被拒', () => {
    const body = signedNotify({ out_trade_no: 'o1', trade_no: 't1', total_amount: '99.00' });
    expect(alipay.parseNotify(body)!.tradeNo).toBe('t1');

    const tampered = body.replace('99.00', '0.01');
    expect(() => alipay.parseNotify(tampered)).toThrow(/verification failed/);

    // 用我方私钥（而非支付宝私钥）签名 → 验签失败
    const params: Record<string, string> = { app_id: APP_ID, trade_status: 'TRADE_SUCCESS', out_trade_no: 'o2', trade_no: 't2', total_amount: '1.00' };
    params['sign'] = signRsa2(buildSignContent(params), pem(appKeys.privateKey));
    expect(() => alipay.parseNotify(new URLSearchParams(params).toString())).toThrow(/verification failed/);
  });

  it('非成功状态（WAIT_BUYER_PAY）→ 忽略（null）', () => {
    const body = signedNotify({ out_trade_no: 'o3', trade_no: 't3', total_amount: '99.00', trade_status: 'WAIT_BUYER_PAY' });
    expect(alipay.parseNotify(body)).toBeNull();
  });

  it('金额计算：分精度无浮点误差', () => {
    expect(orderAmount('pro', 1)).toBe('99.00');
    expect(orderAmount('pro', 12)).toBe('1188.00');
  });
});

describe('全链路：下单 → 通知 → 派发 plan + 有效期（验收项）', () => {
  let orderId: string;

  it('POST /api/billing/checkout 建单并返回收银台 URL', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authed())
      .send({ plan: 'pro', months: 12 })
      .expect(201);
    orderId = res.body.orderId;
    expect(res.body.payUrl).toContain('alipay');
    expect(res.body.payUrl).toContain(encodeURIComponent(orderId));
  });

  it('支付宝通知 → 订单入账 → plan=pro + 12 个月有效期', async () => {
    const body = signedNotify({ out_trade_no: orderId, trade_no: 'alipay-trade-1', total_amount: '1188.00' });
    const res = await request(app)
      .post('/billing/alipay/notify')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(body)
      .expect(200);
    expect(res.text).toBe('success'); // 支付宝要求裸文本

    const usage = await request(app).get(`/api/projects/${projectId}/usage`).set(authed()).expect(200);
    expect(usage.body.plan).toBe('pro');
    expect(usage.body.limit).toBe(10_000);

    const quota = await boot.services.repos.quotas.getQuota(projectId);
    expect(quota?.expiresAt).toBeTruthy();
    const monthsAhead = (quota!.expiresAt!.getTime() - Date.now()) / (30 * 86_400_000);
    expect(monthsAhead).toBeGreaterThan(11);
  });

  it('重复通知幂等（支付宝会重试）', async () => {
    const body = signedNotify({ out_trade_no: orderId, trade_no: 'alipay-trade-1', total_amount: '1188.00' });
    const res = await request(app)
      .post('/billing/alipay/notify')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(body)
      .expect(200);
    expect(res.text).toBe('success');
    const order = await boot.services.repos.quotas.getOrder(orderId);
    expect(order?.status).toBe('paid');
  });

  it('金额不符的通知被拒（400 级错误 → 非 success 应答）', async () => {
    const checkout = await request(app)
      .post('/api/billing/checkout')
      .set(authed())
      .send({ plan: 'pro', months: 1 })
      .expect(201);
    const body = signedNotify({ out_trade_no: checkout.body.orderId, trade_no: 'alipay-trade-2', total_amount: '0.01' });
    const res = await request(app)
      .post('/billing/alipay/notify')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const order = await boot.services.repos.quotas.getOrder(checkout.body.orderId);
    expect(order?.status).toBe('pending'); // 未入账
  });

  it('伪造签名的通知 → 401 fail', async () => {
    const params: Record<string, string> = {
      app_id: APP_ID, trade_status: 'TRADE_SUCCESS', out_trade_no: orderId, trade_no: 'x', total_amount: '1188.00', sign: 'Zm9yZ2Vk', sign_type: 'RSA2',
    };
    const res = await request(app)
      .post('/billing/alipay/notify')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(params).toString())
      .expect(401);
    expect(res.text).toBe('fail');
  });

  it('checkout 是 project owner 专属；非 owner 403', async () => {
    const other = await request(app)
      .post('/auth/register')
      .send({ email: 'pay-other@dev.dev', password: 'password-123' })
      .expect(201);
    // other 在自己项目里是 owner，可下单；但切到别人项目（非成员）→ 403
    await request(app)
      .post('/api/billing/checkout')
      .set({ Authorization: `Bearer ${other.body.token}`, 'X-Project-Id': projectId })
      .send({ plan: 'pro', months: 1 })
      .expect(403);
  });
});

describe('配额过期回落（订单式购买的收口）', () => {
  it('expiresAt 过期 → resolveLimit 按 free 处理', async () => {
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'expired@dev.dev', password: 'password-123' })
      .expect(201);
    // 直接写一条已过期的 pro 配额
    await boot.services.repos.quotas.upsertQuota(
      reg.body.projectId,
      'pro',
      null,
      new Date(Date.now() - 86_400_000),
    );
    const usage = await request(app)
      .get(`/api/projects/${reg.body.projectId}/usage`)
      .set({ Authorization: `Bearer ${reg.body.token}` })
      .expect(200);
    expect(usage.body.plan).toBe('free');
    expect(usage.body.limit).toBe(100);
  });
});

describe('未配置支付宝时', () => {
  it('checkout → 503 明确提示', async () => {
    const bare = await bootstrap({ dbConfig: { type: 'sqlite' }, alipay: null });
    const bareApp = createApp(bare.services);
    const reg = await request(bareApp)
      .post('/auth/register')
      .send({ email: 'noalipay@dev.dev', password: 'password-123' })
      .expect(201);
    const res = await request(bareApp)
      .post('/api/billing/checkout')
      .set({ Authorization: `Bearer ${reg.body.token}` })
      .send({ plan: 'pro', months: 1 })
      .expect(503);
    expect(res.body.error).toMatch(/not configured/);
    await bare.shutdown();
  });
});
