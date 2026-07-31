import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { parseFeed } from '../Rss/rss-utils.js';
import { rssFeedReadDescription } from './RssFeedRead.description.js';

export class RssFeedRead implements INodeType {
  description = rssFeedReadDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    const count = Math.max(1, input.length);
    for (let index = 0; index < count; index++) {
      const url = String(this.getNodeParameter('url', index));
      const payload = await this.helpers.httpRequest({ url, method: 'GET', headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      output.push(...parseFeed(payload).map((json) => ({ json, pairedItem: input[index] ? { item: index } : undefined })));
    }
    return [output];
  }
}
