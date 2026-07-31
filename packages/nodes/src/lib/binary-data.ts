import { basename, extname } from 'node:path';
import type { IBinaryData, INodeExecutionData } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  gif: 'image/gif',
  gz: 'application/gzip',
  gzip: 'application/gzip',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

export function fileExtension(fileName: string): string | undefined {
  const extension = extname(fileName).slice(1).toLowerCase();
  return extension || undefined;
}

export function mimeTypeForFile(fileName: string, fallback = 'application/octet-stream'): string {
  const extension = fileExtension(fileName);
  return (extension ? MIME_BY_EXTENSION[extension] : undefined) ?? fallback;
}

export function requireBinary(item: INodeExecutionData, field: string, nodeName: string): IBinaryData {
  const binary = item.binary?.[field];
  if (!binary) throw new OperationalError(`${nodeName}: binary field "${field}" was not found`, {});
  return binary;
}

export function binaryFileName(binary: IBinaryData, fallback: string): string {
  return basename(binary.fileName?.trim() || fallback);
}

export function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new OperationalError(`${name} must be an integer between 1 and ${maximum}`, {});
  }
  return number;
}
