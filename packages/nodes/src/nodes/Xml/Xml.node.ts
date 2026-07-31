import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, cloneJsonValue, setPath } from '../../lib/data-transform.js';
import { getPath } from '../../lib/object-path.js';
import { xmlDescription } from './Xml.description.js';

const forbiddenXmlKey = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeXmlValue(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeXmlValue);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenXmlKey.has(key)) throw new OperationalError(`XML: forbidden key "${key}"`, {});
    assertSafeXmlValue(child);
  }
}

function parseXml(source: unknown): unknown {
  if (typeof source !== 'string') throw new OperationalError('XML: source field must contain a string', {});
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new OperationalError('XML: document type and entity declarations are not allowed', {});
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    processEntities: false,
    trimValues: false,
  }).parse(source) as unknown;
  assertSafeXmlValue(parsed);
  return cloneJsonValue(parsed);
}

function buildXml(source: unknown, rootName: string, format: boolean): string {
  if (!rootName || !/^[A-Za-z_][\w.-]*$/.test(rootName)) throw new OperationalError('XML: root element name is invalid', {});
  if (source === undefined || typeof source === 'function' || typeof source === 'symbol' || typeof source === 'bigint') {
    throw new OperationalError('XML: source field must contain JSON-compatible data', {});
  }
  assertSafeXmlValue(source);
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format,
    suppressEmptyNode: false,
  }).build({ [rootName]: source } as JsonObject);
}

export class Xml implements INodeType {
  description = xmlDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output = this.getInputData().map((item, itemIndex) => {
      const mode = String(this.getNodeParameter('mode', itemIndex, 'xmlToJson'));
      const sourceField = String(this.getNodeParameter('sourceField', itemIndex, 'data'));
      const source = getPath(item.json, sourceField);
      const result = mode === 'xmlToJson'
        ? parseXml(source)
        : mode === 'jsonToXml'
          ? buildXml(
            source,
            String(this.getNodeParameter('rootName', itemIndex, 'root')).trim(),
            this.getNodeParameter('format', itemIndex, true) === true,
          )
          : undefined;
      if (result === undefined) throw new OperationalError(`XML: unsupported mode "${mode}"`, {});
      const json = cloneJsonObject(item.json);
      setPath(json, String(this.getNodeParameter('outputField', itemIndex, 'data')), result);
      return { ...item, json, pairedItem: { item: itemIndex } };
    });
    return [output];
  }
}
