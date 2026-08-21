import type { INodeTypeDescription } from '@nomops/workflow';

export const nomopsTriggerDescription: INodeTypeDescription = {
  displayName: 'Nomops Trigger',
  name: 'nomopsTrigger',
  group: ['trigger'],
  categories: ['trigger'],
  subcategories: ['Core Events'],
  aliases: ['instance started', 'workflow activated', 'workflow updated'],
  version: 1,
  description: 'Start this workflow for lifecycle events of this Nomops instance',
  defaults: { name: 'Nomops Trigger' },
  inputs: [],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Only this workflow and this instance lifecycle are exposed. The trigger does not read other projects, executions, credentials, or workflow data.',
      name: 'securityNotice',
      type: 'notice',
      default: '',
    },
    {
      displayName: 'Events',
      name: 'events',
      type: 'multiOptions',
      default: ['activate'],
      required: true,
      options: [
        { name: 'Instance Started', value: 'init', description: 'When this Nomops process restores active workflows after startup' },
        { name: 'Workflow Activated', value: 'activate', description: 'When this workflow is activated' },
        { name: 'Published Workflow Updated', value: 'update', description: 'When an active workflow publishes a new version' },
      ],
    },
  ],
};
