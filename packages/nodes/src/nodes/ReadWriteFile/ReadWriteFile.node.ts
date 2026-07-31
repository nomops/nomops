import { basename } from 'node:path';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { mimeTypeForFile, requireBinary } from '../../lib/binary-data.js';
import { readSandboxFile, writeSandboxFile } from '../../lib/file-sandbox.js';
import { readWriteFileDescription } from './ReadWriteFile.description.js';

export class ReadWriteFile implements INodeType {
  description = readWriteFileDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const operation = String(this.getNodeParameter('operation', itemIndex, 'read'));
      const filePath = String(this.getNodeParameter('filePath', itemIndex, ''));
      const binaryPropertyName = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
      if (operation === 'write') {
        const binary = requireBinary(item, binaryPropertyName, 'Read/Write Files from Disk');
        await writeSandboxFile(filePath, await this.helpers.binaryToBuffer(binary), this.getNodeParameter('append', itemIndex, false) === true);
        output.push({ ...item, json: { ...item.json, filePath }, pairedItem: { item: itemIndex } });
      } else if (operation === 'read') {
        const bytes = await readSandboxFile(filePath);
        const fileName = basename(filePath);
        const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType: mimeTypeForFile(fileName) });
        output.push({
          json: { filePath, fileName, mimeType: binary.mimeType, fileSize: binary.fileSize ?? bytes.byteLength },
          binary: { [binaryPropertyName]: binary },
          pairedItem: { item: itemIndex },
        });
      } else {
        throw new OperationalError(`Read/Write Files from Disk: unsupported operation "${operation}"`, {});
      }
    }
    return [output];
  }
}
