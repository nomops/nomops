import type { INodeTypeDescription } from '@nomops/workflow';

export const chatTriggerDescription: INodeTypeDescription = {
  displayName: 'Chat Trigger',
  name: 'chatTrigger',
  group: ['trigger'],
  version: 1,
  description: 'Start the workflow from a chat message (canvas chat panel or POST /api/workflows/:id/chat)',
  defaults: { name: 'When chat message received' },
  inputs: [],
  outputs: ['main'],
  properties: [],
};
