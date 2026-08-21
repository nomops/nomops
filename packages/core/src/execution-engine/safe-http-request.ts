import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import type { IHttpRequestOptions } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { Agent, fetch as undiciFetch } from 'undici';

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-nomops-api-key',
  'x-project-id',
]);

export interface IDnsAddress {
  address: string;
  family: 4 | 6;
}

export type DnsLookupAll = (hostname: string) => Promise<IDnsAddress[]>;

type FetchLike = typeof undiciFetch;

export interface ISafeFetchDependencies {
  fetch?: FetchLike;
  lookup?: DnsLookupAll;
}

export interface ISafeFetchOptions {
  url: URL;
  method: NonNullable<IHttpRequestOptions['method']>;
  headers: Record<string, string>;
  body?: string;
  urlTrust?: IHttpRequestOptions['urlTrust'];
  signal?: AbortSignal;
}

export interface ISafeFetchResult {
  response: Awaited<ReturnType<FetchLike>>;
  close: () => Promise<void>;
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((bytes[0]! << 24) >>> 0) + (bytes[1]! << 16) + (bytes[2]! << 8) + bytes[3]!) >>> 0;
}

function ipv4InRange(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (value === null) return false;
  const blocked: Array<[number, number]> = [
    [0x0000_0000, 8],
    [0x0a00_0000, 8],
    [0x6440_0000, 10],
    [0x7f00_0000, 8],
    [0xa9fe_0000, 16],
    [0xac10_0000, 12],
    [0xc000_0000, 24],
    [0xc000_0200, 24],
    [0xc0a8_0000, 16],
    [0xc633_6400, 24],
    [0xcb00_7100, 24],
    [0xe000_0000, 4],
    [0xf000_0000, 4],
  ];
  return !blocked.some(([base, prefix]) => ipv4InRange(value, base, prefix));
}

function parseIpv6(address: string): Uint8Array | null {
  const normalized = address.replace(/^\[|\]$/g, '').split('%', 1)[0]!.toLowerCase();
  if (!normalized || normalized.split('::').length > 2) return null;
  const [leftRaw, rightRaw = ''] = normalized.split('::');
  const parseSide = (raw: string): number[] | null => {
    if (!raw) return [];
    const groups: number[] = [];
    for (const part of raw.split(':')) {
      if (part.includes('.')) {
        const ipv4 = parseIpv4(part);
        if (ipv4 === null) return null;
        groups.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        groups.push(Number.parseInt(part, 16));
      }
    }
    return groups;
  };
  const left = parseSide(leftRaw ?? '');
  const right = parseSide(rightRaw);
  if (!left || !right) return null;
  const omitted = 8 - left.length - right.length;
  if ((normalized.includes('::') && omitted < 1) || (!normalized.includes('::') && omitted !== 0)) return null;
  const groups = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function hasPrefix(bytes: Uint8Array, prefix: number[], bitLength: number): boolean {
  const fullBytes = Math.floor(bitLength / 8);
  for (let index = 0; index < fullBytes; index++) {
    if (bytes[index] !== prefix[index]) return false;
  }
  const remaining = bitLength % 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return (bytes[fullBytes]! & mask) === (prefix[fullBytes]! & mask);
}

function embeddedIpv4(bytes: Uint8Array): string | null {
  const mapped = hasPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96);
  const compatible = hasPrefix(bytes, Array.from({ length: 12 }, () => 0), 96);
  const nat64 = hasPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, ...Array.from({ length: 8 }, () => 0)], 96);
  if (!mapped && !compatible && !nat64) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const embedded = embeddedIpv4(bytes);
  if (embedded) return isPublicIpv4(embedded);
  const blocked: Array<[number[], number]> = [
    [Array.from({ length: 16 }, () => 0), 128],
    [[...Array.from({ length: 15 }, () => 0), 1], 128],
    [[0x01, 0x00, ...Array.from({ length: 14 }, () => 0)], 64],
    [[0x20, 0x01, 0x00, 0x02, ...Array.from({ length: 12 }, () => 0)], 48],
    [[0x20, 0x01, 0x0d, 0xb8, ...Array.from({ length: 12 }, () => 0)], 32],
    [[0xfc, ...Array.from({ length: 15 }, () => 0)], 7],
    [[0xfe, 0x80, ...Array.from({ length: 14 }, () => 0)], 10],
    [[0xff, ...Array.from({ length: 15 }, () => 0)], 8],
  ];
  return !blocked.some(([prefix, bitLength]) => hasPrefix(bytes, prefix, bitLength));
}

export function isPublicIpAddress(address: string): boolean {
  const bareAddress = address.replace(/^\[|\]$/g, '').split('%', 1)[0]!;
  const family = isIP(bareAddress);
  if (family === 4) return isPublicIpv4(bareAddress);
  if (family === 6) return isPublicIpv6(bareAddress);
  return false;
}

function blockedTarget(hostname: string, address?: string): OperationalError {
  return new OperationalError('Outbound request blocked by network policy', {
    hostname,
    ...(address ? { address } : {}),
  });
}

async function defaultLookupAll(hostname: string): Promise<IDnsAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }) as Promise<IDnsAddress[]>;
}

async function resolvePublicAddresses(hostname: string, lookup: DnsLookupAll): Promise<IDnsAddress[]> {
  const bareHostname = hostname.replace(/^\[|\]$/g, '').split('%', 1)[0]!;
  const literalFamily = isIP(bareHostname);
  const addresses = literalFamily
    ? [{ address: bareHostname, family: literalFamily as 4 | 6 }]
    : await lookup(bareHostname);
  if (addresses.length === 0) throw new OperationalError('Unable to resolve outbound host', { hostname: bareHostname });
  for (const result of addresses) {
    if (!isPublicIpAddress(result.address)) throw blockedTarget(bareHostname, result.address);
  }
  return addresses;
}

export function createSafeConnectionLookup(lookup: DnsLookupAll = defaultLookupAll): LookupFunction {
  return ((hostname: string, options: { family?: number }, callback: (error: Error | null, address?: string, family?: number) => void) => {
    void resolvePublicAddresses(hostname, lookup).then(
      (addresses) => {
        const family = options?.family;
        const selected = addresses.find((entry) => !family || entry.family === family) ?? addresses[0]!;
        callback(null, selected.address, selected.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error('Unable to resolve outbound host')),
    );
  }) as LookupFunction;
}

function sanitizedUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function operationalCause(error: unknown): OperationalError | null {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (current instanceof OperationalError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function redirectedRequest(
  status: number,
  current: URL,
  next: URL,
  method: NonNullable<IHttpRequestOptions['method']>,
  headers: Record<string, string>,
  body: string | undefined,
): { method: NonNullable<IHttpRequestOptions['method']>; headers: Record<string, string>; body?: string } {
  const redirectedHeaders = { ...headers };
  if (current.origin !== next.origin) {
    for (const name of Object.keys(redirectedHeaders)) {
      if (SENSITIVE_REDIRECT_HEADERS.has(name.toLowerCase())) delete redirectedHeaders[name];
    }
  }
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    for (const name of Object.keys(redirectedHeaders)) {
      if (name.toLowerCase().startsWith('content-')) delete redirectedHeaders[name];
    }
    return { method: 'GET', headers: redirectedHeaders };
  }
  return { method, headers: redirectedHeaders, ...(body === undefined ? {} : { body }) };
}

export async function safeFetchWithRedirects(
  input: ISafeFetchOptions,
  dependencies: ISafeFetchDependencies = {},
): Promise<ISafeFetchResult> {
  const fetchImpl = dependencies.fetch ?? undiciFetch;
  const lookup = dependencies.lookup ?? defaultLookupAll;
  let currentUrl = new URL(input.url);
  let method = input.method;
  let headers = { ...input.headers };
  let body = input.body;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      throw new OperationalError('Outbound request URL must use HTTP or HTTPS', { protocol: currentUrl.protocol });
    }
    const strict = input.urlTrust === 'user-controlled';
    if (strict) await resolvePublicAddresses(currentUrl.hostname, lookup);
    const dispatcher = strict
      ? new Agent({ connect: { lookup: createSafeConnectionLookup(lookup) }, autoSelectFamily: false, pipelining: 0 })
      : undefined;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(currentUrl, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        ...(dispatcher ? { dispatcher } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      await dispatcher?.close().catch(() => undefined);
      const blocked = operationalCause(error);
      if (blocked) throw blocked;
      throw new OperationalError('HTTP request failed', {
        url: sanitizedUrl(currentUrl),
        cause: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      let closed = false;
      return {
        response,
        close: async () => {
          if (closed) return;
          closed = true;
          await dispatcher?.close();
        },
      };
    }
    await response.body?.cancel().catch(() => undefined);
    await dispatcher?.close().catch(() => undefined);
    if (redirectCount === MAX_REDIRECTS) {
      throw new OperationalError('HTTP redirect limit exceeded', { url: sanitizedUrl(currentUrl), maxRedirects: MAX_REDIRECTS });
    }
    const nextUrl = new URL(location, currentUrl);
    const redirected = redirectedRequest(response.status, currentUrl, nextUrl, method, headers, body);
    currentUrl = nextUrl;
    method = redirected.method;
    headers = redirected.headers;
    body = redirected.body;
  }
  throw new OperationalError('HTTP redirect limit exceeded', { maxRedirects: MAX_REDIRECTS });
}

export function createDefaultHttpRequest(dependencies: ISafeFetchDependencies = {}) {
  return async (options: IHttpRequestOptions): Promise<unknown> => {
    const url = new URL(options.url);
    for (const [key, value] of Object.entries(options.qs ?? {})) url.searchParams.set(key, String(value));
    const method = options.method ?? 'GET';
    const hasBody = options.body !== undefined && method !== 'GET' && method !== 'HEAD';
    const headers = { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...options.headers };
    const result = await safeFetchWithRedirects({
      url,
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(options.urlTrust ? { urlTrust: options.urlTrust } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }, dependencies);
    try {
      if (!result.response.ok) {
        const text = await result.response.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // 非 JSON 错误响应原样保留文本
        }
        throw new OperationalError(`HTTP ${result.response.status} ${result.response.statusText}`, {
          url: sanitizedUrl(url),
          status: result.response.status,
          body,
        });
      }
      if (options.responseFormat === 'binary') {
        return new Uint8Array(await result.response.arrayBuffer());
      }
      const text = await result.response.text();
      if (options.responseFormat === 'text') return text;
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // 非 JSON 响应原样返回文本
      }
      return body;
    } finally {
      await result.close();
    }
  };
}

export const defaultHttpRequest = createDefaultHttpRequest();
