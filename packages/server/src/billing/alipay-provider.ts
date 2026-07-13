import { createSign, createVerify } from 'node:crypto';
import { WebhookVerifyError } from './payment-provider.js';

/**
 * 支付宝适配（订单式购买，docs/08 支付选型）。
 * 协议要点（开放平台标准）：
 * - 请求签名：参数按 key ASCII 升序拼 `k=v&…`，RSA2（SHA256withRSA）+ 应用私钥
 * - 异步通知验签：同样拼串（剔除 sign/sign_type），用支付宝公钥验
 * - 通知应答必须是裸文本 "success"，否则支付宝持续重试
 */

export interface AlipayConfig {
  appId: string;
  /** 应用私钥（PEM）。 */
  appPrivateKey: string;
  /** 支付宝公钥（PEM，验 notify）。 */
  alipayPublicKey: string;
  /** 网关（生产 https://openapi.alipay.com/gateway.do；沙箱 openapi-sandbox.dl.alipaydev.com）。 */
  gateway: string;
  /** 异步通知地址（公网可达）。 */
  notifyUrl: string;
  /** 支付完成跳回页。 */
  returnUrl?: string;
}

export interface AlipayNotify {
  outTradeNo: string; // 我方订单号（billing_orders.id）
  tradeNo: string; // 支付宝交易号
  totalAmount: string; // 实付金额（元）
  appId: string;
}

/** 按支付宝规范拼待签名串：ASCII 升序、跳过空值与 sign/sign_type。 */
export function buildSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function signRsa2(content: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  return signer.sign(privateKeyPem, 'base64');
}

export function verifyRsa2(content: string, signature: string, publicKeyPem: string): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(content, 'utf8');
  try {
    return verifier.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
}

export class AlipayProvider {
  readonly name = 'alipay';

  constructor(private readonly config: AlipayConfig) {}

  /**
   * 生成 PC 收银台跳转 URL（alipay.trade.page.pay）。
   * 前端拿到 URL 后整页跳转；用户支付后支付宝异步 POST notify。
   */
  buildPagePayUrl(order: { id: string; amount: string; subject: string }): string {
    const params: Record<string, string> = {
      app_id: this.config.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: formatAlipayTimestamp(new Date()),
      version: '1.0',
      notify_url: this.config.notifyUrl,
      ...(this.config.returnUrl ? { return_url: this.config.returnUrl } : {}),
      biz_content: JSON.stringify({
        out_trade_no: order.id,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: order.amount,
        subject: order.subject,
      }),
    };
    params['sign'] = signRsa2(buildSignContent(params), this.config.appPrivateKey);
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return `${this.config.gateway}?${query}`;
  }

  /**
   * 解析并验签异步通知（form-encoded 原文）。
   * 验签失败 / app_id 不符 → WebhookVerifyError；非成功交易状态 → null（忽略）。
   */
  parseNotify(rawFormBody: string): AlipayNotify | null {
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(rawFormBody)) params[k] = v;

    const signature = params['sign'] ?? '';
    if (!signature || !verifyRsa2(buildSignContent(params), signature, this.config.alipayPublicKey)) {
      throw new WebhookVerifyError('Alipay notification signature verification failed');
    }
    if (params['app_id'] !== this.config.appId) {
      throw new WebhookVerifyError('Alipay notification app_id does not match');
    }
    const status = params['trade_status'];
    if (status !== 'TRADE_SUCCESS' && status !== 'TRADE_FINISHED') {
      return null; // WAIT_BUYER_PAY / TRADE_CLOSED 等：忽略
    }
    if (!params['out_trade_no'] || !params['trade_no'] || !params['total_amount']) {
      throw new WebhookVerifyError('Alipay notification is missing required fields');
    }
    return {
      outTradeNo: params['out_trade_no'],
      tradeNo: params['trade_no'],
      totalAmount: params['total_amount'],
      appId: params['app_id'],
    };
  }
}

/** 支付宝要求 yyyy-MM-dd HH:mm:ss（东八区习惯；MVP 用本地时间）。 */
function formatAlipayTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 从环境变量构造（未配置返回 null——checkout 端点将回 503 提示）。 */
export function alipayFromEnv(): AlipayProvider | null {
  const appId = process.env['ALIPAY_APP_ID'];
  const appPrivateKey = process.env['ALIPAY_APP_PRIVATE_KEY'];
  const alipayPublicKey = process.env['ALIPAY_PUBLIC_KEY'];
  const notifyUrl = process.env['ALIPAY_NOTIFY_URL'];
  if (!appId || !appPrivateKey || !alipayPublicKey || !notifyUrl) return null;
  return new AlipayProvider({
    appId,
    appPrivateKey,
    alipayPublicKey,
    notifyUrl,
    gateway: process.env['ALIPAY_GATEWAY'] ?? 'https://openapi.alipay.com/gateway.do',
    returnUrl: process.env['ALIPAY_RETURN_URL'],
  });
}
