import { defaultHttpRequest } from '@nomops/core';
import { OperationalError, type IHttpRequestOptions } from '@nomops/workflow';

export type DeploymentMode = 'regular' | 'queue';

export interface SupportTicketInput {
  requesterName: string;
  requesterEmail: string;
  subject: string;
  description: string;
}

export interface SupportTicketResult {
  id: string;
  status: 'open';
  createdAt: string;
}

export interface SupportConfiguration {
  url?: string;
  token?: string;
  productVersion: string;
  deploymentMode: DeploymentMode;
}

export class SupportServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function endpointFor(baseUrl: string): string {
  let url: URL;
  try { url=new URL(baseUrl); } catch { throw new SupportServiceError(503,'support_invalid_configuration','支持服务配置无效，请联系管理员'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) {
    throw new SupportServiceError(503,'support_invalid_configuration','支持服务配置无效，请联系管理员');
  }
  url.pathname='/api/instance/v1/tickets'; url.search=''; url.hash='';
  return url.href;
}

function upstreamStatus(error: unknown): number | null {
  if (!(error instanceof OperationalError)) return null;
  return typeof error.context['status']==='number' ? error.context['status'] : null;
}

function mappedError(status: number | null): SupportServiceError {
  if (status===400) return new SupportServiceError(502,'support_upstream_rejected','支持服务拒绝了请求，请稍后重试');
  if (status===401) return new SupportServiceError(503,'support_authentication_failed','支持服务鉴权失败，请联系管理员');
  if (status===409) return new SupportServiceError(409,'support_idempotency_conflict','该请求标识已用于不同的支持请求');
  if (status===429) return new SupportServiceError(429,'support_rate_limited','支持请求过于频繁，请稍后重试');
  return new SupportServiceError(502,'support_unavailable','支持服务暂时不可用，请稍后重试');
}

function parseResult(value: unknown): SupportTicketResult {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw mappedError(502);
  const body=value as Record<string,unknown>;
  if (typeof body['id']!=='string' || !body['id'] || body['id'].length>200 || body['status']!=='open' ||
    typeof body['createdAt']!=='string' || !Number.isFinite(Date.parse(body['createdAt']))) throw mappedError(502);
  return {id:body['id'],status:'open',createdAt:body['createdAt']};
}

export class SupportService {
  private readonly request: (options:IHttpRequestOptions)=>Promise<unknown>;

  constructor(
    private readonly config: SupportConfiguration,
    request: (options:IHttpRequestOptions)=>Promise<unknown> = defaultHttpRequest,
    private readonly timeoutMs = 8_000,
  ) {
    this.request=request;
  }

  status(): {enabled:boolean} {
    return {enabled:Boolean(this.config.url?.trim() && this.config.token?.trim())};
  }

  async submit(input: SupportTicketInput, idempotencyKey: string): Promise<SupportTicketResult> {
    if (!this.status().enabled) throw new SupportServiceError(503,'support_not_configured','支持服务尚未配置，请联系管理员');
    const url=endpointFor(this.config.url!.trim());
    const body={...input,productVersion:this.config.productVersion,deploymentMode:this.config.deploymentMode};
    for (let attempt=1;attempt<=2;attempt+=1) {
      const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
      try {
        const value=await this.request({url,method:'POST',headers:{
          authorization:`Bearer ${this.config.token!.trim()}`,
          'idempotency-key':idempotencyKey,
          'content-type':'application/json',
        },body,urlTrust:'user-controlled',signal:controller.signal});
        return parseResult(value);
      } catch (error) {
        const timedOut=controller.signal.aborted;
        const status=upstreamStatus(error);
        const retryable=!timedOut && (status===null || status>=500);
        if (attempt<2 && retryable) continue;
        if (timedOut) throw new SupportServiceError(504,'support_timeout','支持服务响应超时，请稍后重试');
        throw mappedError(status);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw mappedError(null);
  }
}
