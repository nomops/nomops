import type { INodeTypeDescription } from '@nomops/workflow';

export const sseTriggerDescription: INodeTypeDescription = {
  displayName: 'SSE Trigger',
  name: 'sseTrigger',
  group: ['trigger'],
  categories: ['trigger'],
  aliases: ['server sent events', 'event stream'],
  version: 1,
  description: 'Start the workflow for events received from an SSE stream',
  defaults: { name: 'SSE Trigger' },
  inputs: [],
  outputs: ['main'],
  properties: [
    { displayName: 'Stream URL', name: 'url', type: 'string', default: '', required: true, placeholder: 'https://example.com/events' },
    { displayName: 'Event Name', name: 'eventName', type: 'string', default: '', description: 'Only emit named events; empty accepts all events' },
    { displayName: 'Headers', name: 'headers', type: 'json', default: {}, description: 'Optional request headers' },
  ],
};
