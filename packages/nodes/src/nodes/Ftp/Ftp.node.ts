import { basename } from 'node:path';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { mimeTypeForFile, positiveInteger, requireBinary } from '../../lib/binary-data.js';
import { connectRemoteFileClient } from '../../lib/remote-file-client.js';
import { ftpDescription } from './Ftp.description.js';

export class Ftp implements INodeType {
  description = ftpDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const protocol = String(this.getNodeParameter('protocol', 0, 'ftp'));
    if (protocol !== 'ftp' && protocol !== 'sftp') throw new OperationalError(`FTP: unsupported protocol "${protocol}"`, {});
    const credentials = await this.getCredentials(protocol);
    const timeout = positiveInteger(this.getNodeParameter('timeout', 0, 10000), 'FTP timeout', 300_000);
    let client;
    try {
      client = await connectRemoteFileClient(protocol, credentials, timeout);
    } catch {
      throw new OperationalError(`${protocol.toUpperCase()} connection failed`, {});
    }
    const output: INodeExecutionData[] = [];
    try {
      for (const [itemIndex, item] of items.entries()) {
        const operation = String(this.getNodeParameter('operation', itemIndex, 'download'));
        const remotePath = String(this.getNodeParameter('path', itemIndex, '/'));
        if (operation === 'list') {
          output.push(...(await client.list(remotePath)).map((json) => ({ json, pairedItem: { item: itemIndex } })));
        } else if (operation === 'download') {
          const field = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
          const bytes = await client.download(remotePath);
          const fileName = basename(remotePath) || 'download.bin';
          const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType: mimeTypeForFile(fileName) });
          output.push({ ...item, binary: { ...item.binary, [field]: binary }, pairedItem: { item: itemIndex } });
        } else if (operation === 'upload') {
          const field = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
          const binary = requireBinary(item, field, 'FTP');
          await client.upload(remotePath, await this.helpers.binaryToBuffer(binary));
          output.push({ ...item, json: { ...item.json, success: true, path: remotePath }, pairedItem: { item: itemIndex } });
        } else throw new OperationalError(`FTP: unsupported operation "${operation}"`, {});
      }
    } catch (error) {
      if (error instanceof OperationalError) throw error;
      throw new OperationalError(`${protocol.toUpperCase()} ${String(this.getNodeParameter('operation', 0, 'operation'))} failed`, {});
    } finally {
      await client.close().catch(() => undefined);
    }
    return [output];
  }
}
