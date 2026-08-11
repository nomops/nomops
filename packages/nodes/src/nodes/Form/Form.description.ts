import type { INodeTypeDescription } from '@nomops/workflow';
import { formElementsProperty } from '../FormTrigger/FormTrigger.description.js';

export const formDescription: INodeTypeDescription = {
  displayName: 'Form',
  name: 'form',
  group: ['flow'],
  categories: ['humanReview', 'flow'],
  aliases: ['n8n form', 'next form page', 'form ending', 'human input'],
  version: 1,
  description: 'Generate a page in a multi-step form or finish a form workflow',
  defaults: { name: 'Form' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Page Type', name: 'operation', type: 'options', default: 'nextPage',
      options: [{ name: 'Next Form Page', value: 'nextPage' }, { name: 'Form Ending', value: 'completion' }],
    },
    {
      displayName: 'Define Form', name: 'defineForm', type: 'options', default: 'fields',
      displayOptions: { show: { operation: ['nextPage'] } },
      options: [{ name: 'Using Fields Below', value: 'fields' }, { name: 'Using JSON', value: 'json' }],
    },
    { ...formElementsProperty, displayOptions: { show: { operation: ['nextPage'], defineForm: ['fields'] } } },
    {
      displayName: 'Form Elements JSON', name: 'jsonOutput', type: 'json', default: '[]',
      typeOptions: { rows: 8, editor: 'code' }, displayOptions: { show: { operation: ['nextPage'], defineForm: ['json'] } },
    },
    {
      displayName: 'On n8n Form Submission', name: 'respondWith', type: 'options', default: 'text',
      displayOptions: { show: { operation: ['completion'] } },
      options: [
        { name: 'Show Completion Screen', value: 'text' },
        { name: 'Redirect to URL', value: 'redirect' },
        { name: 'Show Text', value: 'responseText' },
        { name: 'Return Binary File', value: 'binary' },
      ],
    },
    { displayName: 'Completion Title', name: 'completionTitle', type: 'string', default: 'Submitted', displayOptions: { show: { operation: ['completion'], respondWith: ['text'] } } },
    { displayName: 'Completion Message', name: 'completionMessage', type: 'string', default: 'Your response has been received.', typeOptions: { rows: 3 }, displayOptions: { show: { operation: ['completion'], respondWith: ['text'] } } },
    { displayName: 'Redirect URL', name: 'redirectUrl', type: 'string', default: '', placeholder: 'https://example.com', displayOptions: { show: { operation: ['completion'], respondWith: ['redirect'] } } },
    { displayName: 'Text', name: 'responseText', type: 'string', default: '', typeOptions: { rows: 4 }, displayOptions: { show: { operation: ['completion'], respondWith: ['responseText'] } } },
    { displayName: 'Input Binary Field', name: 'inputDataFieldName', type: 'string', default: 'data', displayOptions: { show: { operation: ['completion'], respondWith: ['binary'] } } },
    { displayName: 'Limit Wait Time', name: 'limitWaitTime', type: 'boolean', default: false, displayOptions: { show: { operation: ['nextPage'] } } },
    { displayName: 'Max Wait Time', name: 'maxWaitTime', type: 'number', default: 1, displayOptions: { show: { limitWaitTime: [true] } } },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [
        { name: 'Form Title', value: 'formTitle', values: [{ displayName: 'Form Title', name: 'formTitle', type: 'string', default: '', placeholder: 'e.g. Contact us' }] },
        { name: 'Form Description', value: 'formDescription', values: [{ displayName: 'Form Description', name: 'formDescription', type: 'string', default: '', typeOptions: { rows: 3 } }] },
        { name: 'Button Label', value: 'buttonLabel', values: [{ displayName: 'Button Label', name: 'buttonLabel', type: 'string', default: 'Submit' }] },
        { name: 'Custom Form Styling', value: 'customCss', values: [{ displayName: 'Custom Form Styling', name: 'customCss', type: 'string', default: '', typeOptions: { rows: 6, editor: 'code' } }] },
      ],
    },
  ],
};
