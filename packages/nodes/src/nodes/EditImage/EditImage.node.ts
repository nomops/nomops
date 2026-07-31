import { extname } from 'node:path';
import sharp, { type FormatEnum } from 'sharp';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { binaryFileName, mimeTypeForFile, positiveInteger, requireBinary } from '../../lib/binary-data.js';
import { editImageDescription } from './EditImage.description.js';

function nonNegativeInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 50_000) throw new OperationalError(`${name} must be an integer between 0 and 50000`, {});
  return number;
}

function opacity(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new OperationalError('Edit Image: opacity must be between 0 and 1', {});
  return number;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function watermarkSvg(width: number, height: number, text: string, position: string, fontSize: number, alpha: number): Buffer {
  const margin = Math.max(8, Math.round(fontSize / 2));
  const positions: Record<string, { x: number | string; y: number; anchor: string }> = {
    center: { x: '50%', y: Math.round(height / 2), anchor: 'middle' },
    northwest: { x: margin, y: margin + fontSize, anchor: 'start' },
    northeast: { x: width - margin, y: margin + fontSize, anchor: 'end' },
    southwest: { x: margin, y: height - margin, anchor: 'start' },
    southeast: { x: width - margin, y: height - margin, anchor: 'end' },
  };
  const point = positions[position] ?? positions['southeast']!;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${point.x}" y="${point.y}" text-anchor="${point.anchor}" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="rgba(255,255,255,${alpha})" stroke="rgba(0,0,0,${Math.min(1, alpha + 0.2)})" stroke-width="1">${escapeXml(text)}</text></svg>`);
}

function outputName(inputName: string, requested: string, format: string): string {
  if (requested.trim()) return requested.trim();
  if (format === 'keep') return inputName;
  const stem = extname(inputName) ? inputName.slice(0, -extname(inputName).length) : inputName;
  return `${stem}.${format === 'jpeg' ? 'jpg' : format}`;
}

export class EditImage implements INodeType {
  description = editImageDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output = await Promise.all(this.getInputData().map(async (item, itemIndex) => {
      const sourceField = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
      const destinationField = String(this.getNodeParameter('destinationField', itemIndex, 'data'));
      const source = requireBinary(item, sourceField, 'Edit Image');
      const input = await this.helpers.binaryToBuffer(source);
      const operation = String(this.getNodeParameter('operation', itemIndex, 'resize'));
      let pipeline = sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 });
      if (operation === 'resize') {
        const width = positiveInteger(this.getNodeParameter('width', itemIndex, 500), 'Edit Image width', 50_000);
        const height = positiveInteger(this.getNodeParameter('height', itemIndex, 500), 'Edit Image height', 50_000);
        const mode = String(this.getNodeParameter('resizeMode', itemIndex, 'inside'));
        pipeline = pipeline.resize(width, height, { fit: mode === 'fill' ? 'fill' : mode === 'cover' ? 'cover' : 'inside' });
      } else if (operation === 'crop') {
        pipeline = pipeline.extract({
          left: nonNegativeInteger(this.getNodeParameter('positionX', itemIndex, 0), 'Edit Image position X'),
          top: nonNegativeInteger(this.getNodeParameter('positionY', itemIndex, 0), 'Edit Image position Y'),
          width: positiveInteger(this.getNodeParameter('width', itemIndex, 500), 'Edit Image width', 50_000),
          height: positiveInteger(this.getNodeParameter('height', itemIndex, 500), 'Edit Image height', 50_000),
        });
      } else if (operation === 'watermark') {
        const metadata = await pipeline.metadata();
        if (!metadata.width || !metadata.height) throw new OperationalError('Edit Image: input image dimensions are unavailable', {});
        const fontSize = positiveInteger(this.getNodeParameter('fontSize', itemIndex, 32), 'Edit Image font size', 1000);
        pipeline = pipeline.composite([{ input: watermarkSvg(
          metadata.width,
          metadata.height,
          String(this.getNodeParameter('watermarkText', itemIndex, 'nomops')),
          String(this.getNodeParameter('watermarkPosition', itemIndex, 'southeast')),
          fontSize,
          opacity(this.getNodeParameter('opacity', itemIndex, 0.6)),
        ) }]);
      } else throw new OperationalError(`Edit Image: unsupported operation "${operation}"`, {});

      const format = String(this.getNodeParameter('format', itemIndex, 'keep'));
      const quality = positiveInteger(this.getNodeParameter('quality', itemIndex, 90), 'Edit Image quality', 100);
      if (format !== 'keep') pipeline = pipeline.toFormat(format as keyof FormatEnum, { quality });
      const bytes = await pipeline.toBuffer();
      const fileName = outputName(binaryFileName(source, 'image.png'), String(this.getNodeParameter('fileName', itemIndex, '')), format);
      const mimeType = format === 'keep' ? source.mimeType : mimeTypeForFile(fileName, `image/${format}`);
      const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType });
      return { ...item, binary: { ...item.binary, [destinationField]: binary }, pairedItem: { item: itemIndex } };
    }));
    return [output];
  }
}
