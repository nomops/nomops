import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createDefaultHttpRequest, createSafeConnectionLookup, isPublicIpAddress } from './safe-http-request.js';

const publicAddress = { address: '93.184.216.34', family: 4 as const };

function response(body: string | null, init: ResponseInit): Response {
  return new Response(body, init);
}

describe('SSRF 出站防护', () => {
  it('拒绝 IPv4/IPv6 的私网、回环、链路本地与映射地址', () => {
    expect(isPublicIpAddress('93.184.216.34')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '::',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '64:ff9b::7f00:1',
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it('在发起连接前拒绝云 metadata 字面地址', async () => {
    const fetch = vi.fn();
    const request = createDefaultHttpRequest({ fetch: fetch as never });
    await expect(request({ url: 'http://169.254.169.254/latest/meta-data', urlTrust: 'user-controlled' }))
      .rejects.toThrow('blocked by network policy');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('DNS 解析到私网时拒绝，连接期 lookup 也执行同一校验', async () => {
    const resolvePrivate = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
    const fetch = vi.fn();
    const request = createDefaultHttpRequest({ lookup: resolvePrivate, fetch: fetch as never });
    await expect(request({ url: 'https://private.test/data', urlTrust: 'user-controlled' }))
      .rejects.toThrow('blocked by network policy');
    expect(fetch).not.toHaveBeenCalled();

    const connectionLookup = createSafeConnectionLookup(resolvePrivate) as unknown as (
      hostname: string,
      options: object,
      callback: (error: Error | null, address?: string, family?: number) => void,
    ) => void;
    await expect(new Promise<void>((resolve, reject) => {
      connectionLookup('rebind.test', {}, (error) => error ? reject(error) : resolve());
    })).rejects.toThrow('blocked by network policy');
  });

  it('每次重定向重新校验目标并拒绝跳转到内网', async () => {
    const lookup = vi.fn(async (hostname: string) => hostname === 'public.test'
      ? [publicAddress]
      : [{ address: '127.0.0.1', family: 4 as const }]);
    const fetch = vi.fn(async () => response(null, { status: 302, headers: { location: 'http://private.test/admin' } }));
    const request = createDefaultHttpRequest({ lookup, fetch: fetch as never });
    await expect(request({ url: 'https://public.test/start', urlTrust: 'user-controlled' }))
      .rejects.toThrow('blocked by network policy');
    expect(fetch).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('private.test');
  });

  it('跨域重定向剥离授权头', async () => {
    const lookup = vi.fn(async () => [publicAddress]);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: 'https://other.test/final' } }))
      .mockResolvedValueOnce(response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const request = createDefaultHttpRequest({ lookup, fetch: fetch as never });
    await expect(request({
      url: 'https://public.test/start',
      headers: { Authorization: 'Bearer secret', 'x-request-id': 'r1' },
      urlTrust: 'user-controlled',
    })).resolves.toEqual({ ok: true });
    const secondInit = fetch.mock.calls[1]![1] as { headers: Record<string, string> };
    expect(secondInit.headers).toEqual({ 'x-request-id': 'r1' });
  });

  it('固定内部目标可显式保持 trusted，不走用户 URL 防护', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
    const fetch = vi.fn(async () => response('{"internal":true}', { status: 200 }));
    const request = createDefaultHttpRequest({ lookup, fetch: fetch as never });
    await expect(request({ url: 'http://127.0.0.1/internal', urlTrust: 'trusted' }))
      .resolves.toEqual({ internal: true });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('真实本地服务仅允许 trusted 请求，严格请求在连接前被拦截', async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.setHeader('content-type', 'application/json');
      response.end('{"local":true}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
      const url = `http://127.0.0.1:${address.port}/health`;
      const request = createDefaultHttpRequest();
      await expect(request({ url, urlTrust: 'trusted' })).resolves.toEqual({ local: true });
      await expect(request({ url, urlTrust: 'user-controlled' })).rejects.toThrow('blocked by network policy');
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
