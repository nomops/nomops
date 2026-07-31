import type { INodeProperties, INodeTypeDescription } from '@nomops/workflow';

export const formFieldProperty: INodeProperties = {
  displayName: 'Form Fields',
  name: 'fields',
  type: 'fixedCollection',
  default: { values: [{ name: 'email', label: 'Email', type: 'email', required: true, placeholder: '', options: '' }] },
  required: true,
  placeholder: 'Add Form Field',
  typeOptions: { multipleValues: true, sortable: true, fixedCollection: { itemTitle: 'Field', layout: 'vertical' } },
  options: [{
    name: 'values',
    value: 'values',
    values: [
      { displayName: 'Field Name', name: 'name', type: 'string', default: '', required: true },
      { displayName: 'Label', name: 'label', type: 'string', default: '', required: true },
      {
        displayName: 'Type', name: 'type', type: 'options', default: 'text', options: [
          { name: 'Text', value: 'text' }, { name: 'Email', value: 'email' },
          { name: 'Number', value: 'number' }, { name: 'Date', value: 'date' },
          { name: 'Checkbox', value: 'checkbox' }, { name: 'Textarea', value: 'textarea' },
          { name: 'Select', value: 'select' },
        ],
      },
      { displayName: 'Required', name: 'required', type: 'boolean', default: false },
      { displayName: 'Placeholder', name: 'placeholder', type: 'string', default: '' },
      { displayName: 'Options', name: 'options', type: 'string', default: '', description: 'Comma-separated options for Select fields' },
    ],
  }],
};

export const formTriggerDescription: INodeTypeDescription = {
  displayName: 'Form Trigger',
  name: 'formTrigger',
  group: ['trigger'],
  categories: ['trigger', 'humanReview'],
  aliases: ['public form', 'survey'],
  version: 1,
  description: 'Start the workflow when a public form is submitted',
  defaults: { name: 'Form Trigger' },
  inputs: [],
  outputs: ['main'],
  webhooks: [
    { httpMethod: 'GET', path: { parameter: 'path' } },
    { httpMethod: 'HEAD', path: { parameter: 'path' } },
    { httpMethod: 'POST', path: { parameter: 'path' } },
  ],
  properties: [
    { displayName: 'Path', name: 'path', type: 'string', default: 'form', required: true },
    { displayName: 'Form Title', name: 'formTitle', type: 'string', default: 'Submit your details', required: true },
    { displayName: 'Form Description', name: 'formDescription', type: 'string', default: '', typeOptions: { rows: 3 } },
    formFieldProperty,
    { displayName: 'Submit Button Label', name: 'submitLabel', type: 'string', default: 'Submit' },
  ],
};
