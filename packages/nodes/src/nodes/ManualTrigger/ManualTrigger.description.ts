import type { INodeTypeDescription } from '@nomops/workflow';

export const manualTriggerDescription: INodeTypeDescription = {
  displayName: 'Manual Trigger',
  name: 'manualTrigger',
  group: ['trigger'],
  categories: ['trigger'],
  version: 1,
  description: 'Runs the flow on clicking a button in n8n. Good for getting started quickly',
  defaults: { name: 'When clicking ‘Execute workflow’' },
  inputs: [],
  outputs: ['main'],
  properties: [],
};
