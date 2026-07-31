import { XMLParser } from 'fast-xml-parser';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function arrayOf(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return scalar((value as Record<string, unknown>)['#text']);
  return undefined;
}

function atomLink(value: unknown): string | undefined {
  for (const link of arrayOf(value)) {
    if (typeof link === 'string') return link;
    if (!link || typeof link !== 'object') continue;
    const record = link as Record<string, unknown>;
    const rel = scalar(record['@_rel']);
    const href = scalar(record['@_href']);
    if (href && (!rel || rel === 'alternate')) return href;
  }
  return undefined;
}

function jsonSafe(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key))
        .map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return String(value ?? '');
}

function normalizeEntry(entry: unknown, atom: boolean): JsonObject {
  const raw = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
  const title = scalar(raw['title']);
  const link = atom ? atomLink(raw['link']) : scalar(raw['link']);
  const guid = scalar(raw['guid']) ?? scalar(raw['id']);
  const published = scalar(raw['pubDate']) ?? scalar(raw['published']) ?? scalar(raw['updated']);
  const content = scalar(raw['content:encoded']) ?? scalar(raw['content']) ?? scalar(raw['description']) ?? scalar(raw['summary']);
  const author = scalar(raw['dc:creator']) ?? scalar(raw['author']);
  const categories = arrayOf(raw['category']).map(scalar).filter((value): value is string => Boolean(value));
  return {
    ...(jsonSafe(raw) as JsonObject),
    ...(title ? { title } : {}),
    ...(link ? { link } : {}),
    ...(guid ? { guid } : {}),
    ...(published ? { pubDate: published } : {}),
    ...(content ? { content } : {}),
    ...(author ? { creator: author } : {}),
    ...(categories.length > 0 ? { categories } : {}),
  };
}

export function parseFeed(payload: unknown): JsonObject[] {
  if (typeof payload !== 'string') throw new OperationalError('RSS response must be XML text');
  let document: Record<string, unknown>;
  try {
    document = parser.parse(payload) as Record<string, unknown>;
  } catch (error) {
    throw new OperationalError(`Invalid RSS/Atom feed: ${(error as Error).message}`);
  }
  const rss = document['rss'] as Record<string, unknown> | undefined;
  const channel = rss?.['channel'] as Record<string, unknown> | undefined;
  if (channel) return arrayOf(channel['item']).map((entry) => normalizeEntry(entry, false));
  const feed = document['feed'] as Record<string, unknown> | undefined;
  if (feed) return arrayOf(feed['entry']).map((entry) => normalizeEntry(entry, true));
  const rdf = document['rdf:RDF'] as Record<string, unknown> | undefined;
  if (rdf) return arrayOf(rdf['item']).map((entry) => normalizeEntry(entry, false));
  throw new OperationalError('Response is not a supported RSS or Atom feed');
}

export function feedItemKey(item: JsonObject): string {
  const key = item['guid'] ?? item['id'] ?? item['link'];
  if (typeof key === 'string' && key.length > 0) return key;
  return `${String(item['title'] ?? '')}|${String(item['pubDate'] ?? '')}|${String(item['content'] ?? '')}`;
}
