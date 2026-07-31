import type { INodeTypeDescription } from '@nomops/workflow';

export const sendEmailDescription: INodeTypeDescription = {
  displayName: 'Send Email',
  name: 'sendEmail',
  group: ['output'],
  categories: ['core'],
  aliases: ['email', 'smtp', 'mail'],
  version: 1,
  description: 'Send an email through an SMTP server',
  defaults: { name: 'Send Email' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'smtp', required: true }],
  properties: [
    { displayName: 'From Email', name: 'fromEmail', type: 'string', default: '', required: true, placeholder: 'nomops@example.com' },
    { displayName: 'To Email', name: 'toEmail', type: 'string', default: '', required: true, placeholder: 'user@example.com' },
    { displayName: 'CC Email', name: 'ccEmail', type: 'string', default: '' },
    { displayName: 'BCC Email', name: 'bccEmail', type: 'string', default: '' },
    { displayName: 'Reply To', name: 'replyTo', type: 'string', default: '' },
    { displayName: 'Subject', name: 'subject', type: 'string', default: '', required: true },
    {
      displayName: 'Content Type', name: 'contentType', type: 'options', default: 'text', noDataExpression: true,
      options: [{ name: 'Text', value: 'text' }, { name: 'HTML', value: 'html' }],
    },
    { displayName: 'Text', name: 'text', type: 'string', default: '', displayOptions: { show: { contentType: ['text'] } } },
    { displayName: 'Text Fallback', name: 'text', type: 'string', default: '', displayOptions: { show: { contentType: ['html'] } } },
    { displayName: 'HTML', name: 'html', type: 'string', default: '', displayOptions: { show: { contentType: ['html'] } } },
  ],
};
