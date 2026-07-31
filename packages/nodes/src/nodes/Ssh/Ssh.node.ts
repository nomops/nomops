import { basename } from 'node:path';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { mimeTypeForFile, positiveInteger, requireBinary } from '../../lib/binary-data.js';
import { connectSshClient } from '../../lib/ssh-client.js';
import { sshDescription } from './Ssh.description.js';

export class Ssh implements INodeType {
  description = sshDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const authentication = String(this.getNodeParameter('authentication', 0, 'password'));
    const credentialType = authentication === 'privateKey' ? 'sshPrivateKey' : 'sshPassword';
    const credentials = await this.getCredentials(credentialType);
    const timeout = positiveInteger(this.getNodeParameter('timeout', 0, 30_000), 'SSH timeout', 300_000);
    const client = await connectSshClient(credentials, timeout).catch(() => {
      throw new OperationalError('SSH connection failed', {});
    });
    const output: INodeExecutionData[] = [];
    try {
      for (const [itemIndex, item] of items.entries()) {
        const resource = String(this.getNodeParameter('resource', itemIndex, 'command'));
        const operation = String(this.getNodeParameter('operation', itemIndex, resource === 'command' ? 'execute' : 'upload'));
        if (resource === 'command' && operation === 'execute') {
          const command = String(this.getNodeParameter('command', itemIndex, '')).trim();
          if (!command) throw new OperationalError('SSH command is required', {});
          const cwd = String(this.getNodeParameter('cwd', itemIndex, '')).trim();
          const result = await client.execute(command, cwd || undefined);
          output.push({ json: { ...item.json, ...result }, pairedItem: { item: itemIndex } });
        } else if (resource === 'file' && operation === 'download') {
          const path = String(this.getNodeParameter('path', itemIndex, '')).trim();
          const field = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
          const bytes = await client.download(path);
          const fileName = basename(path) || 'download.bin';
          const binary = await this.helpers.bufferToBinary(bytes, { fileName, mimeType: mimeTypeForFile(fileName) });
          output.push({ ...item, binary: { ...item.binary, [field]: binary }, pairedItem: { item: itemIndex } });
        } else if (resource === 'file' && operation === 'upload') {
          const path = String(this.getNodeParameter('path', itemIndex, '')).trim();
          const field = String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'));
          const binary = requireBinary(item, field, 'SSH');
          await client.upload(path, await this.helpers.binaryToBuffer(binary));
          output.push({ json: { ...item.json, success: true, path }, pairedItem: { item: itemIndex } });
        } else {
          throw new OperationalError(`SSH: unsupported ${resource}/${operation}`, {});
        }
      }
      return [output];
    } catch (error) {
      if (error instanceof OperationalError) throw error;
      throw new OperationalError('SSH operation failed', {});
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
