import type { INodeTypeDescription } from '@nomops/workflow';
import { formFieldProperty } from '../FormTrigger/FormTrigger.description.js';

export const formDescription: INodeTypeDescription = {
  displayName: 'Form',
  name: 'form',
  group: ['flow'],
  categories: ['humanReview', 'flow'],
  aliases: ['human input', 'approval form', 'hitl'],
  version: 1,
  description: 'Pause the workflow and continue after an internal form is submitted',
  defaults: { name: 'Form' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    { displayName: 'Form Title', name: 'formTitle', type: 'string', default: 'Your input is required', required: true },
    { displayName: 'Form Description', name: 'formDescription', type: 'string', default: '', typeOptions: { rows: 3 } },
    formFieldProperty,
    { displayName: 'Submit Button Label', name: 'submitLabel', type: 'string', default: 'Continue' },
  ],
};
