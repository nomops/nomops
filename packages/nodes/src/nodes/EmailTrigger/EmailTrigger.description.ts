import type { INodeTypeDescription } from '@nomops/workflow';

export const emailTriggerDescription: INodeTypeDescription = {
  displayName: 'Email Trigger (IMAP)',
  name: 'emailTrigger',
  group: ['trigger'],
  categories: ['trigger', 'core'],
  subcategories: ['App Events'],
  aliases: ['email', 'imap', 'inbox', 'mail trigger'],
  version: 1,
  description: 'Trigger the workflow when a new email is received',
  defaults: { name: 'Email Trigger (IMAP)' },
  inputs: [],
  outputs: ['main'],
  credentials: [{ name: 'imap', required: true }],
  polling: true,
  properties: [
    { displayName: 'Mailbox Name', name: 'mailbox', type: 'string', default: 'INBOX', required: true },
    {
      displayName: 'After Fetching', name: 'postProcessAction', type: 'options', default: 'read', noDataExpression: true,
      options: [{ name: 'Mark as Read', value: 'read' }, { name: 'Do Nothing', value: 'nothing' }],
    },
    {
      displayName: 'Format', name: 'format', type: 'options', default: 'simple', noDataExpression: true,
      options: [{ name: 'Simple', value: 'simple' }, { name: 'RAW', value: 'raw' }],
    },
    { displayName: 'Poll Interval (Seconds)', name: 'pollInterval', type: 'number', default: 60, required: true },
    { displayName: 'Timeout (ms)', name: 'timeout', type: 'number', default: 15_000, required: true },
  ],
};
