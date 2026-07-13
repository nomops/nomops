import type { INodeTypeDescription } from '@nomops/workflow';

export const manualTriggerDescription: INodeTypeDescription = {
  displayName: 'Manual Trigger',
  name: 'manualTrigger',
  group: ['trigger'],
  version: 1,
  description: 'Starting point for running a workflow manually',
  defaults: { name: 'When clicking Run' },
  inputs: [],
  outputs: ['main'],
  properties: [],
};
