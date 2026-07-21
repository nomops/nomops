import type { INodeTypeDescription } from '@nomops/workflow';

export const executeWorkflowTriggerDescription: INodeTypeDescription = {
  displayName: 'Execute Workflow Trigger',
  name: 'executeWorkflowTrigger',
  group: ['trigger'],
  version: 1,
  description: 'Start this workflow when another workflow calls it via the Execute Workflow node',
  defaults: { name: 'Execute Workflow Trigger' },
  inputs: [],
  outputs: ['main'],
  properties: [],
};
