import type { IExecuteContext, INodeExecutionData, INodeType, IPollContext } from '@nomops/workflow';
import { feedItemKey, parseFeed } from '../Rss/rss-utils.js';
import { rssFeedReadTriggerDescription } from './RssFeedReadTrigger.description.js';

export class RssFeedReadTrigger implements INodeType {
  description = rssFeedReadTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: {} }]];
  }

  async poll(this: IPollContext): Promise<INodeExecutionData[][] | null> {
    const url = String(this.getNodeParameter('url'));
    const payload = await this.helpers.httpRequest({
      url,
      method: 'GET',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      urlTrust: 'user-controlled',
    });
    const entries = parseFeed(payload);
    const keys = entries.map(feedItemKey);
    const fresh = new Set(await this.helpers.filterNewKeys(keys));
    const output = entries.filter((entry, index) => fresh.has(keys[index]!)).map((json) => ({ json }));
    return output.length > 0 ? [output] : null;
  }
}
