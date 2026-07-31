import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { mimeTypeForFile } from '../../lib/binary-data.js';
import { recordsToCsv, recordsToXlsx } from '../../lib/file-formats.js';
import { getPath } from '../../lib/object-path.js';
import { convertToFileDescription } from './ConvertToFile.description.js';

export class ConvertToFile implements INodeType {
  description = convertToFileDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = String(this.getNodeParameter('operation', 0, 'csv'));
    const binaryPropertyName = String(this.getNodeParameter('binaryPropertyName', 0, 'data'));
    const fileName = String(this.getNodeParameter('fileName', 0, `data.${operation}`));
    if (operation === 'binary') {
      const output = await Promise.all(items.map(async (item, itemIndex) => {
        const sourceField = String(this.getNodeParameter('sourceField', itemIndex, 'data'));
        const value = getPath(item.json, sourceField);
        if (typeof value !== 'string') throw new OperationalError(`Convert to File: source field "${sourceField}" must contain a string`, {});
        const encoding = String(this.getNodeParameter('sourceEncoding', itemIndex, 'base64'));
        const bytes = Buffer.from(value, encoding === 'utf8' ? 'utf8' : 'base64');
        const mimeType = String(this.getNodeParameter('mimeType', itemIndex, mimeTypeForFile(fileName)));
        const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType });
        return { ...item, binary: { ...item.binary, [binaryPropertyName]: binary }, pairedItem: { item: itemIndex } };
      }));
      return [output];
    }

    const records = items.map((item) => item.json as JsonObject);
    let bytes: Uint8Array;
    let mimeType: string;
    if (operation === 'csv') {
      bytes = recordsToCsv(records, String(this.getNodeParameter('delimiter', 0, ',')));
      mimeType = 'text/csv';
    } else if (operation === 'json') {
      bytes = Buffer.from(JSON.stringify(records, null, 2), 'utf8');
      mimeType = 'application/json';
    } else if (operation === 'xlsx') {
      bytes = await recordsToXlsx(records, String(this.getNodeParameter('sheetName', 0, 'Sheet1')));
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      throw new OperationalError(`Convert to File: unsupported operation "${operation}"`, {});
    }
    const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType });
    const first = items[0] ?? { json: {} };
    return [[{
      ...first,
      binary: { ...first.binary, [binaryPropertyName]: binary },
      pairedItem: items.map((_, item) => ({ item })),
    }]];
  }
}
