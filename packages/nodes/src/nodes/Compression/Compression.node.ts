import { basename } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { unzipSync, zipSync } from 'fflate';
import type { IBinaryData, IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { binaryFileName, mimeTypeForFile, positiveInteger, requireBinary } from '../../lib/binary-data.js';
import { compressionDescription } from './Compression.description.js';

function limits(): { bytes: number; entries: number } {
  return {
    bytes: positiveInteger(process.env['NOMOPS_COMPRESSION_MAX_BYTES'] ?? 104_857_600, 'NOMOPS_COMPRESSION_MAX_BYTES', 1_073_741_824),
    entries: positiveInteger(process.env['NOMOPS_COMPRESSION_MAX_ENTRIES'] ?? 1000, 'NOMOPS_COMPRESSION_MAX_ENTRIES', 100_000),
  };
}

function fields(value: unknown): string[] {
  const names = String(value).split(',').map((field) => field.trim()).filter(Boolean);
  if (names.length === 0) throw new OperationalError('Compression: at least one binary field is required', {});
  return names;
}

function gzipOutputName(binary: IBinaryData): string {
  const fileName = binaryFileName(binary, 'file');
  return fileName.endsWith('.gz') ? fileName.slice(0, -3) || 'file' : fileName;
}

export class Compression implements INodeType {
  description = compressionDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const operation = String(this.getNodeParameter('operation', itemIndex, 'compress'));
      const binaryFields = fields(this.getNodeParameter('binaryPropertyNames', itemIndex, 'data'));
      if (operation === 'compress') {
        const format = String(this.getNodeParameter('outputFormat', itemIndex, 'zip'));
        const outputField = String(this.getNodeParameter('outputField', itemIndex, 'data'));
        const requestedFileName = String(this.getNodeParameter('fileName', itemIndex, format === 'zip' ? 'archive.zip' : 'file.gz'));
        if (format === 'zip') {
          const files: Record<string, Uint8Array> = {};
          for (const field of binaryFields) {
            const binary = requireBinary(item, field, 'Compression');
            let fileName = binaryFileName(binary, `${field}.bin`);
            if (files[fileName]) fileName = `${field}-${fileName}`;
            files[fileName] = await this.helpers.binaryToBuffer(binary);
          }
          const bytes = zipSync(files, { level: 6 });
          const fileName = requestedFileName.endsWith('.zip') ? requestedFileName : `${requestedFileName}.zip`;
          const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType: 'application/zip' });
          output.push({ ...item, binary: { ...item.binary, [outputField]: binary }, pairedItem: { item: itemIndex } });
        } else if (format === 'gzip') {
          for (const [fieldIndex, field] of binaryFields.entries()) {
            const source = requireBinary(item, field, 'Compression');
            const bytes = gzipSync(await this.helpers.binaryToBuffer(source));
            const fileName = binaryFields.length === 1
              ? (requestedFileName.endsWith('.gz') ? requestedFileName : `${requestedFileName}.gz`)
              : `${binaryFileName(source, field)}.gz`;
            const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType: 'application/gzip' });
            output.push({
              ...item,
              binary: { ...item.binary, [`${outputField}${fieldIndex || ''}`]: binary },
              pairedItem: { item: itemIndex },
            });
          }
        } else throw new OperationalError(`Compression: unsupported format "${format}"`, {});
      } else if (operation === 'decompress') {
        const outputPrefix = String(this.getNodeParameter('outputPrefix', itemIndex, 'file_'));
        const binaryOutput: Record<string, IBinaryData> = {};
        const max = limits();
        let outputIndex = 0;
        for (const field of binaryFields) {
          const source = requireBinary(item, field, 'Compression');
          const bytes = await this.helpers.binaryToBuffer(source);
          const sourceName = binaryFileName(source, field);
          if (source.mimeType === 'application/zip' || sourceName.toLowerCase().endsWith('.zip')) {
            let count = 0;
            let total = 0;
            const archive = unzipSync(bytes, { filter: (entry) => {
              count++;
              total += entry.originalSize;
              if (count > max.entries) throw new OperationalError('Compression: archive entry limit exceeded', {});
              if (total > max.bytes) throw new OperationalError('Compression: decompressed size limit exceeded', {});
              return !entry.name.endsWith('/');
            } });
            for (const [archiveName, data] of Object.entries(archive)) {
              const fileName = basename(archiveName.replaceAll('\\', '/')) || `file-${outputIndex}`;
              binaryOutput[`${outputPrefix}${outputIndex++}`] = await this.helpers.bufferToBinary(data, {
                fileName,
                mimeType: mimeTypeForFile(fileName),
              });
            }
          } else if (source.mimeType === 'application/gzip' || /\.gz(ip)?$/i.test(sourceName)) {
            const data = gunzipSync(bytes, { maxOutputLength: max.bytes });
            const fileName = gzipOutputName(source);
            binaryOutput[`${outputPrefix}${outputIndex++}`] = await this.helpers.bufferToBinary(data, {
              fileName,
              mimeType: mimeTypeForFile(fileName),
            });
          } else throw new OperationalError(`Compression: unsupported archive "${sourceName}"`, {});
        }
        output.push({ ...item, binary: binaryOutput, pairedItem: { item: itemIndex } });
      } else throw new OperationalError(`Compression: unsupported operation "${operation}"`, {});
    }
    return [output];
  }
}
