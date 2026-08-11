import type { INodeTypeDescription } from '@nomops/workflow';

export const rssFeedReadTriggerDescription: INodeTypeDescription = {
  displayName: 'RSS Feed Trigger',
  name: 'rssFeedReadTrigger',
  group: ['trigger'],
  categories: ['trigger'],
  subcategories: ['App Events'],
  aliases: ['rss poll', 'atom trigger'],
  version: 1,
  description: 'Start the workflow when a feed publishes new entries',
  defaults: { name: 'RSS Feed Trigger' },
  inputs: [],
  outputs: ['main'],
  polling: true,
  properties: [
    { displayName: 'Feed URL', name: 'url', type: 'string', default: '', required: true, placeholder: 'https://example.com/feed.xml' },
    { displayName: 'Poll Interval (Seconds)', name: 'pollInterval', type: 'number', default: 300, required: true },
  ],
};
