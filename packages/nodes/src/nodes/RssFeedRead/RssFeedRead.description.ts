import type { INodeTypeDescription } from '@nomops/workflow';

export const rssFeedReadDescription: INodeTypeDescription = {
  displayName: 'RSS Read',
  name: 'rssFeedRead',
  group: ['input'],
  categories: ['core'],
  aliases: ['feed reader', 'atom'],
  version: 1,
  description: 'Read entries from an RSS or Atom feed',
  defaults: { name: 'RSS Read' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    { displayName: 'Feed URL', name: 'url', type: 'string', default: '', required: true, placeholder: 'https://example.com/feed.xml' },
  ],
};
