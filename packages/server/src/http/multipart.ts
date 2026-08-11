import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import formidable, { type File, type Files, type Fields } from 'formidable';
import type { IBinaryData } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { IBinaryDataStore } from '@nomops/core';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 20 * 1024 * 1024;

function scalarFields(fields: Fields): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => {
    const list = (value ?? []).map(String);
    return [name, list.length <= 1 ? (list[0] ?? '') : list];
  }));
}

function safeFileName(file: File): string | undefined {
  const name = basename(file.originalFilename ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  return name || undefined;
}

async function storeFile(file: File, binaryStore?: IBinaryDataStore): Promise<IBinaryData> {
  const buffer = await readFile(file.filepath);
  const meta = {
    mimeType: file.mimetype || 'application/octet-stream',
    ...(safeFileName(file) ? { fileName: safeFileName(file) } : {}),
  };
  if (binaryStore) return binaryStore.put(buffer, meta);
  return { data: buffer.toString('base64'), ...meta, fileSize: buffer.byteLength };
}

async function binaryFiles(files: Files, binaryStore?: IBinaryDataStore): Promise<Record<string, IBinaryData | IBinaryData[]>> {
  const result: Record<string, IBinaryData | IBinaryData[]> = {};
  const temporaryFiles: File[] = [];
  try {
    for (const [fieldName, value] of Object.entries(files)) {
      const list = (Array.isArray(value) ? value : value ? [value] : []) as File[];
      temporaryFiles.push(...list);
      const stored: IBinaryData[] = [];
      for (const file of list) stored.push(await storeFile(file, binaryStore));
      if (stored.length > 0) result[fieldName] = stored.length === 1 ? stored[0]! : stored;
    }
    return result;
  } finally {
    await Promise.all(temporaryFiles.map((file) => rm(file.filepath, { force: true }).catch(() => undefined)));
  }
}

export interface ParsedMultipartForm {
  fields: Record<string, string | string[]>;
  files: Record<string, IBinaryData | IBinaryData[]>;
}

/** Parse an inbound form with bounded disk/memory usage, then move bytes into the execution binary store. */
export async function parseMultipartForm(
  request: IncomingMessage,
  binaryStore?: IBinaryDataStore,
): Promise<ParsedMultipartForm> {
  const uploadDir = await mkdtemp(join(tmpdir(), 'nomops-upload-'));
  try {
    const form = formidable({
      allowEmptyFiles: true,
      minFileSize: 0,
      maxFiles: 20,
      maxFileSize: MAX_FILE_SIZE,
      maxTotalFileSize: MAX_TOTAL_FILE_SIZE,
      maxFields: 100,
      maxFieldsSize: 1024 * 1024,
      multiples: true,
      uploadDir,
    });
    const [fields, files] = await form.parse(request);
    return { fields: scalarFields(fields), files: await binaryFiles(files, binaryStore) };
  } catch (error) {
    const typed = error as { message?: string; httpCode?: number; code?: number };
    const status = typed.httpCode === 413 || typed.code === 1009 || typed.code === 1016 ? 413 : 400;
    throw new OperationalError(`Invalid multipart form submission: ${typed.message ?? 'parse failed'}`, { status });
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
}
