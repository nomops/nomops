import type { INodeTypeDescription } from '@nomops/workflow';

export const waitDescription: INodeTypeDescription = {
  displayName: 'Wait',
  name: 'wait',
  group: ['transform'],
  categories: ['humanReview', 'flow'],
  version: 1,
  description: 'Wait before continuing with the next node',
  defaults: { name: 'Wait' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Resume', name: 'resume', type: 'options', default: 'timeInterval',
      options: [
        { name: 'After Time Interval', value: 'timeInterval', description: 'Waits for a certain amount of time' },
        { name: 'At Specified Time', value: 'specificTime', description: 'Waits until a specific date and time to continue' },
        { name: 'On Webhook Call', value: 'webhook', description: 'Waits for a webhook call before continuing' },
        { name: 'On Form Submitted', value: 'form', description: 'Waits for a form submission before continuing' },
      ],
    },
    {
      displayName: 'Wait Amount', name: 'amount', type: 'number', default: 5,
      displayOptions: { show: { resume: ['timeInterval', 'afterDelay'] } },
    },
    {
      displayName: 'Wait Unit', name: 'unit', type: 'options', default: 'seconds',
      displayOptions: { show: { resume: ['timeInterval', 'afterDelay'] } },
      options: [
        { name: 'Seconds', value: 'seconds' }, { name: 'Minutes', value: 'minutes' },
        { name: 'Hours', value: 'hours' }, { name: 'Days', value: 'days' },
      ],
    },
    {
      displayName: 'Date and Time', name: 'dateTime', type: 'dateTime', default: '',
      displayOptions: { show: { resume: ['specificTime'] } },
    },
    {
      displayName: 'Authentication', name: 'incomingAuthentication', type: 'options', default: 'none',
      displayOptions: { show: { resume: ['webhook', 'form'] } },
      options: [
        { name: 'None', value: 'none' }, { name: 'Basic Auth', value: 'basic' },
        { name: 'Header Auth', value: 'header' }, { name: 'JWT Auth', value: 'jwt' },
      ],
    },
    {
      displayName: 'The webhook URL is generated at run time and can be referenced with the $execution.resumeUrl variable.',
      name: 'webhookNotice', type: 'notice', default: '', typeOptions: { noticeStyle: 'info' },
      displayOptions: { show: { resume: ['webhook'] } },
    },
    {
      displayName: 'HTTP Method', name: 'httpMethod', type: 'options', default: 'GET',
      displayOptions: { show: { resume: ['webhook'] } },
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ name: value, value })),
    },
    {
      displayName: 'Response Code', name: 'responseCode', type: 'number', default: 200,
      displayOptions: { show: { resume: ['webhook'] } },
    },
    {
      displayName: 'Respond', name: 'responseMode', type: 'options', default: 'onReceived',
      displayOptions: { show: { resume: ['webhook'] } },
      options: [
        { name: 'Immediately', value: 'onReceived' },
        { name: 'When Last Node Finishes', value: 'lastNode' },
        { name: 'Using Respond to Webhook Node', value: 'responseNode' },
      ],
    },
    {
      displayName: 'The form URL is generated at run time and can be referenced with the $execution.resumeFormUrl variable.',
      name: 'formNotice', type: 'notice', default: '', typeOptions: { noticeStyle: 'info' },
      displayOptions: { show: { resume: ['form'] } },
    },
    { displayName: 'Form Title', name: 'formTitle', type: 'string', default: '', displayOptions: { show: { resume: ['form'] } } },
    { displayName: 'Form Description', name: 'formDescription', type: 'string', default: '', typeOptions: { rows: 3 }, displayOptions: { show: { resume: ['form'] } } },
    {
      displayName: 'Form Elements', name: 'formFields', type: 'fixedCollection', default: { values: [] },
      placeholder: 'Add Form Element', typeOptions: { multipleValues: true, sortable: true },
      displayOptions: { show: { resume: ['form'] } },
      options: [{ name: 'values', value: 'values', values: [
        { displayName: 'Label', name: 'fieldLabel', type: 'string', default: '', required: true },
        { displayName: 'Element Type', name: 'fieldType', type: 'options', default: 'text', options: [
          { name: 'Checkboxes', value: 'checkbox' }, { name: 'Custom HTML', value: 'html' },
          { name: 'Date', value: 'date' }, { name: 'Dropdown', value: 'dropdown' },
          { name: 'Email', value: 'email' }, { name: 'File', value: 'file' },
          { name: 'Hidden Field', value: 'hidden' }, { name: 'Number', value: 'number' },
          { name: 'Password', value: 'password' }, { name: 'Radio Buttons', value: 'radio' },
          { name: 'Text Input', value: 'text' }, { name: 'Textarea', value: 'textarea' },
        ] },
        { displayName: 'Required Field', name: 'requiredField', type: 'boolean', default: false },
      ] }],
    },
    {
      displayName: 'Respond When', name: 'formResponseMode', type: 'options', default: 'onReceived',
      displayOptions: { show: { resume: ['form'] } },
      options: [
        { name: 'Form Is Submitted', value: 'onReceived' },
        { name: 'Workflow Finishes', value: 'lastNode' },
      ],
    },
    {
      displayName: 'Limit Wait Time', name: 'limitWaitTime', type: 'boolean', default: false,
      displayOptions: { show: { resume: ['webhook', 'form'] } },
    },
    {
      displayName: 'Max Wait Time', name: 'maxWaitTime', type: 'number', default: 1,
      displayOptions: { show: { limitWaitTime: [true] } },
    },
    {
      displayName: 'Max Wait Time Unit', name: 'maxWaitTimeUnit', type: 'options', default: 'hours',
      displayOptions: { show: { limitWaitTime: [true] } },
      options: [
        { name: 'Minutes', value: 'minutes' }, { name: 'Hours', value: 'hours' }, { name: 'Days', value: 'days' },
      ],
    },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [] },
  ],
};
