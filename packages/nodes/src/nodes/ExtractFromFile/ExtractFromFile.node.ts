import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { requireBinary } from '../../lib/binary-data.js';
import { csvToRecords, extractPdfText, xlsxToRecords } from '../../lib/file-formats.js';
import { extractFromFileDescription } from './ExtractFromFile.description.js';

function jsonRecords(value: unknown): JsonObject[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ? entry as JsonObject
    : { value: entry });
}

export class ExtractFromFile implements INodeType {
  description = extractFromFileDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const operation = String(this.getNodeParameter('operation', itemIndex, 'csv'));
      const field = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
      const bytes = await this.helpers.binaryToBuffer(requireBinary(item, field, 'Extract from File'));
      let records: JsonObject[];
      if (operation === 'csv') records = csvToRecords(bytes, String(this.getNodeParameter('delimiter', itemIndex, ',')));
      else if (operation === 'json') {
        try { records = jsonRecords(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); }
        catch { throw new OperationalError('Extract from File: invalid JSON file', {}); }
      } else if (operation === 'xlsx') {
        const sheetName = String(this.getNodeParameter('sheetName', itemIndex, '')).trim();
        records = await xlsxToRecords(bytes, sheetName || undefined);
      } else if (operation === 'text') {
        records = [{ [String(this.getNodeParameter('outputField', itemIndex, 'text'))]: Buffer.from(bytes).toString('utf8') }];
      } else if (operation === 'pdf') {
        const pdf = await extractPdfText(bytes);
        records = [{ [String(this.getNodeParameter('outputField', itemIndex, 'text'))]: pdf.text, pageCount: pdf.pageCount }];
      } else throw new OperationalError(`Extract from File: unsupported operation "${operation}"`, {});
      output.push(...records.map((json) => ({ json, pairedItem: { item: itemIndex } })));
    }
    return [output];
  }
}
