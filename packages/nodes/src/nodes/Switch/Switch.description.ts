import type { INodeTypeDescription } from '@nomops/workflow';

export const switchDescription: INodeTypeDescription = {
  displayName: 'Switch',
  name: 'switch',
  group: ['transform'],
  categories: ['dataTransformation', 'flow'],
  version: 1,
  description: 'Route items to one of four outputs — rule i sends matching items to output i (first match wins)',
  defaults: { name: 'Switch' },
  inputs: ['main'],
  outputs: ['main', 'main', 'main', 'main'],
  outputNames: ['0', '1', '2', '3'],
  properties: [
    {
      displayName: 'Routing Rules',
      name: 'rules',
      type: 'filter',
      default: [],
      description:
        'Rule i routes matching items to output i (first match wins, max 4 rules); left/right support expressions',
    },
    {
      displayName: 'Fallback Output',
      name: 'fallbackOutput',
      type: 'options',
      default: 'none',
      options: [
        { name: 'None (discard item)', value: 'none' },
        { name: 'Output 0', value: '0' },
        { name: 'Output 1', value: '1' },
        { name: 'Output 2', value: '2' },
        { name: 'Output 3', value: '3' },
      ],
      description: 'Where to send items that match no rule',
    },
  ],
};
