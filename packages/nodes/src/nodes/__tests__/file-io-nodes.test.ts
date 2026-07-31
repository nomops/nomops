import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IBinaryData, IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { Compression } from '../Compression/Compression.node.js';
import { ConvertToFile } from '../ConvertToFile/ConvertToFile.node.js';
import { EditImage } from '../EditImage/EditImage.node.js';
import { ExtractFromFile } from '../ExtractFromFile/ExtractFromFile.node.js';
import { Ftp } from '../Ftp/Ftp.node.js';
import { ReadWriteFile } from '../ReadWriteFile/ReadWriteFile.node.js';
import { connectRemoteFileClient } from '../../lib/remote-file-client.js';

vi.mock('../../lib/remote-file-client.js', () => ({ connectRemoteFileClient: vi.fn() }));

function inlineBinary(data: Uint8Array, mimeType: string, fileName?: string): IBinaryData {
  return { data: Buffer.from(data).toString('base64'), mimeType, fileName, fileSize: data.byteLength };
}

function context(
  items: INodeExecutionData[],
  parameters: Record<string, unknown | ((index: number) => unknown)> = {},
  credentials: JsonObject = {},
): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in parameters)) return fallback;
      const value = parameters[name];
      return typeof value === 'function' ? (value as (index: number) => unknown)(itemIndex) : value;
    },
    getCredentials: async () => credentials,
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    helpers: {
      httpRequest: async () => ({}),
      binaryToBuffer: async (binary) => Buffer.from(binary.data ?? '', 'base64'),
      bufferToBinary: async (buffer, meta) => inlineBinary(buffer, meta.mimeType, meta.fileName),
    },
  } as IExecuteContext;
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env['NOMOPS_FILES_ROOT'];
  delete process.env['NOMOPS_COMPRESSION_MAX_BYTES'];
});

describe('Read/Write Files from Disk', () => {
  it('在沙箱内写入并读回同一份 binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomops-files-'));
    process.env['NOMOPS_FILES_ROOT'] = root;
    try {
      const source = inlineBinary(Buffer.from('你好 file'), 'text/plain', 'source.txt');
      const written = await new ReadWriteFile().execute!.call(context([{ json: {}, binary: { data: source } }], {
        operation: 'write', filePath: 'reports/out.txt', binaryPropertyName: 'data',
      }));
      expect(written[0]![0]!.json['filePath']).toBe('reports/out.txt');

      const read = await new ReadWriteFile().execute!.call(context([{ json: {} }], {
        operation: 'read', filePath: 'reports/out.txt', binaryPropertyName: 'file',
      }));
      expect(Buffer.from(read[0]![0]!.binary!['file']!.data!, 'base64').toString()).toBe('你好 file');
      expect(() => JSON.stringify(read)).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('拒绝绝对路径、上跳路径和符号链接逃逸', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomops-files-'));
    const outside = await mkdtemp(join(tmpdir(), 'nomops-outside-'));
    process.env['NOMOPS_FILES_ROOT'] = root;
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'link'));
    try {
      for (const filePath of ['/etc/passwd', '../outside.txt', 'link/secret.txt']) {
        await expect(new ReadWriteFile().execute!.call(context([{ json: {} }], {
          operation: 'read', filePath, binaryPropertyName: 'data',
        }))).rejects.toThrow(/NOMOPS_FILES_ROOT|Symbolic links/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('Convert to File ↔ Extract from File', () => {
  const records = [{ json: { name: 'A,一', count: 2, nested: { ok: true } } }, { json: { name: 'B', count: 3, nested: [1, 2] } }];

  it.each(['csv', 'json', 'xlsx'] as const)('%s 文件往返保持 items', async (operation) => {
    const converted = await new ConvertToFile().execute!.call(context(records, {
      operation, fileName: `records.${operation}`, binaryPropertyName: 'data', delimiter: ',', sheetName: 'Records',
    }));
    const extracted = await new ExtractFromFile().execute!.call(context(converted[0]!, {
      operation, binaryPropertyName: 'data', delimiter: ',', sheetName: 'Records',
    }));
    expect(extracted[0]!.map((item) => item.json)).toEqual(records.map((item) => item.json));
    expect(() => JSON.stringify(extracted)).not.toThrow();
  });

  it('支持文本和 PDF 提取', async () => {
    const text = await new ExtractFromFile().execute!.call(context([{
      json: {}, binary: { data: inlineBinary(Buffer.from('文本🙂'), 'text/plain', 'text.txt') },
    }], { operation: 'text', binaryPropertyName: 'data', outputField: 'content' }));
    expect(text[0]![0]!.json).toEqual({ content: '文本🙂' });

    const pdf = await new ExtractFromFile().execute!.call(context([{
      json: {}, binary: { data: inlineBinary(minimalPdf('Hello PDF'), 'application/pdf', 'sample.pdf') },
    }], { operation: 'pdf', binaryPropertyName: 'data', outputField: 'content' }));
    expect(pdf[0]![0]!.json['content']).toContain('Hello PDF');
    expect(pdf[0]![0]!.json['pageCount']).toBe(1);
  });

  it('Base64 字符串可转回 binary', async () => {
    const output = await new ConvertToFile().execute!.call(context([{ json: { payload: Buffer.from('BYTES').toString('base64') } }], {
      operation: 'binary', sourceField: 'payload', sourceEncoding: 'base64', fileName: 'raw.bin', binaryPropertyName: 'file', mimeType: 'application/octet-stream',
    }));
    expect(Buffer.from(output[0]![0]!.binary!['file']!.data!, 'base64').toString()).toBe('BYTES');
  });
});

describe('Compression', () => {
  it.each(['zip', 'gzip'] as const)('%s 压缩解压往返', async (format) => {
    const input = [{ json: { id: 1 }, binary: { data: inlineBinary(Buffer.from('archive-content'), 'text/plain', 'hello.txt') } }];
    const compressed = await new Compression().execute!.call(context(input, {
      operation: 'compress', binaryPropertyNames: 'data', outputFormat: format, fileName: format === 'zip' ? 'files.zip' : 'hello.txt.gz', outputField: 'archive',
    }));
    const decompressed = await new Compression().execute!.call(context(compressed[0]!, {
      operation: 'decompress', binaryPropertyNames: 'archive', outputPrefix: 'file_',
    }));
    expect(Buffer.from(decompressed[0]![0]!.binary!['file_0']!.data!, 'base64').toString()).toBe('archive-content');
  });

  it('解压超过配置上限时拒绝', async () => {
    process.env['NOMOPS_COMPRESSION_MAX_BYTES'] = '16';
    const source = [{ json: {}, binary: { data: inlineBinary(Buffer.alloc(128, 65), 'text/plain', 'large.txt') } }];
    const compressed = await new Compression().execute!.call(context(source, {
      operation: 'compress', binaryPropertyNames: 'data', outputFormat: 'zip', fileName: 'large.zip', outputField: 'archive',
    }));
    await expect(new Compression().execute!.call(context(compressed[0]!, {
      operation: 'decompress', binaryPropertyNames: 'archive', outputPrefix: 'file_',
    }))).rejects.toThrow(/size limit exceeded/);
  });
});

describe('FTP', () => {
  it('上传、下载、列目录均经适配器且凭证不进入输出', async () => {
    const remote = {
      list: vi.fn(async () => [{ name: 'a.txt', type: 'file', size: 3 }]),
      download: vi.fn(async () => Buffer.from('GET')),
      upload: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(connectRemoteFileClient).mockResolvedValue(remote);
    const credentials = { host: 'files.example.com', username: 'u', password: 'ftp-secret' };
    const upload = await new Ftp().execute!.call(context([{
      json: {}, binary: { data: inlineBinary(Buffer.from('PUT'), 'text/plain', 'put.txt') },
    }], { protocol: 'ftp', operation: 'upload', path: '/put.txt', binaryPropertyName: 'data', timeout: 1000 }, credentials));
    expect(remote.upload).toHaveBeenCalledWith('/put.txt', expect.any(Uint8Array));
    expect(JSON.stringify(upload)).not.toContain('ftp-secret');

    const download = await new Ftp().execute!.call(context([{ json: {} }], {
      protocol: 'ftp', operation: 'download', path: '/get.txt', binaryPropertyName: 'data', timeout: 1000,
    }, credentials));
    expect(Buffer.from(download[0]![0]!.binary!['data']!.data!, 'base64').toString()).toBe('GET');

    const listed = await new Ftp().execute!.call(context([{ json: {} }], {
      protocol: 'ftp', operation: 'list', path: '/', timeout: 1000,
    }, credentials));
    expect(listed[0]![0]!.json).toEqual({ name: 'a.txt', type: 'file', size: 3 });
  });

  it('连接错误不泄露密码', async () => {
    vi.mocked(connectRemoteFileClient).mockRejectedValue(new Error('password=ftp-secret'));
    await expect(new Ftp().execute!.call(context([{ json: {} }], {
      protocol: 'sftp', operation: 'list', path: '/', timeout: 1000,
    }, { password: 'ftp-secret' }))).rejects.not.toThrow(/ftp-secret/);
  });
});

describe('Edit Image', () => {
  it.each([
    ['resize', { width: 20, height: 10, resizeMode: 'fill' }, 20, 10],
    ['crop', { width: 15, height: 12, positionX: 2, positionY: 3 }, 15, 12],
    ['watermark', { watermarkText: '<safe>', watermarkPosition: 'center', fontSize: 12, opacity: 0.5 }, 40, 30],
  ] as const)('%s 产出有效图片', async (operation, operationParams, width, height) => {
    const source = await sharp({ create: { width: 40, height: 30, channels: 4, background: '#336699' } }).png().toBuffer();
    const output = await new EditImage().execute!.call(context([{
      json: {}, binary: { data: inlineBinary(source, 'image/png', 'source.png') },
    }], {
      operation, binaryPropertyName: 'data', destinationField: 'edited', format: 'png', quality: 90, ...operationParams,
    }));
    const metadata = await sharp(Buffer.from(output[0]![0]!.binary!['edited']!.data!, 'base64')).metadata();
    expect([metadata.width, metadata.height]).toEqual([width, height]);
    expect(() => JSON.stringify(output)).not.toThrow();
  });
});
