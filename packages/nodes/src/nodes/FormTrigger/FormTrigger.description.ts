import type { INodeProperties, INodeTypeDescription } from '@nomops/workflow';

const fieldTypes = [
  { name: 'Checkboxes', value: 'checkbox' }, { name: 'Custom HTML', value: 'html' },
  { name: 'Date', value: 'date' }, { name: 'Dropdown', value: 'dropdown' },
  { name: 'Email', value: 'email' }, { name: 'File', value: 'file' },
  { name: 'Hidden Field', value: 'hidden' }, { name: 'Number', value: 'number' },
  { name: 'Password', value: 'password' }, { name: 'Radio Buttons', value: 'radio' },
  { name: 'Text Input', value: 'text' }, { name: 'Textarea', value: 'textarea' },
];

export const formElementsProperty: INodeProperties = {
  displayName: 'Form Elements', name: 'formFields', type: 'fixedCollection', default: { values: [] },
  placeholder: 'Add Form Element',
  typeOptions: {
    multipleValues: true, sortable: true, hideOptionalFields: true, addOptionalFieldButtonText: 'Add Attributes',
    fixedCollection: { itemTitle: 'Element', addButtonLabel: 'Add Form Element', layout: 'vertical' },
  },
  options: [{
    name: 'values', value: 'values', values: [
      { displayName: 'Label', name: 'fieldLabel', type: 'string', default: '', required: true, placeholder: 'e.g. What is your name?' },
      { displayName: 'Element Type', name: 'fieldType', type: 'options', default: 'text', required: true, options: fieldTypes },
      { displayName: 'Custom Field Name', name: 'fieldName', type: 'string', default: '', description: 'Optional stable output key; generated from the label if blank' },
      { displayName: 'Required Field', name: 'requiredField', type: 'boolean', default: false, displayOptions: { hide: { fieldType: ['html', 'hidden'] } } },
      { displayName: 'Placeholder', name: 'placeholder', type: 'string', default: '' },
      {
        displayName: 'Field Options', name: 'fieldOptions', type: 'fixedCollection', default: { values: [] },
        displayOptions: { show: { fieldType: ['dropdown', 'radio', 'checkbox'] } },
        required: true, typeOptions: { multipleValues: true, sortable: true },
        options: [{ name: 'values', value: 'values', values: [{ displayName: 'Option', name: 'option', type: 'string', default: '' }] }],
      },
      { displayName: 'HTML', name: 'html', type: 'string', default: '', required: true, typeOptions: { rows: 4, editor: 'code' }, displayOptions: { show: { fieldType: ['html'] } } },
      { displayName: 'Multiple Files', name: 'multipleFiles', type: 'boolean', default: true, description: 'Whether to allow selecting multiple files', displayOptions: { show: { fieldType: ['file'] } } },
      { displayName: 'Accepted File Types', name: 'acceptFileTypes', type: 'string', default: '', description: 'Comma-separated list of allowed file extensions', placeholder: 'e.g. .jpg, .png', displayOptions: { show: { fieldType: ['file'] } } },
    ],
  }],
};

/** Kept as an export alias for community nodes compiled against the previous package surface. */
export const formFieldProperty = formElementsProperty;

export const formTriggerDescription: INodeTypeDescription = {
  displayName: 'On form submission',
  name: 'formTrigger',
  group: ['trigger'],
  categories: ['trigger', 'humanReview'],
  aliases: ['n8n form', 'public form', 'survey'],
  version: 1,
  description: 'Generate webforms and pass their responses to the workflow',
  defaults: { name: 'On form submission' },
  inputs: [],
  outputs: ['main'],
  credentials: [
    { name: 'httpBasicAuth', required: true, displayOptions: { show: { authentication: ['basic'] } } },
  ],
  webhooks: [
    { httpMethod: 'GET', path: { parameter: 'path' } },
    { httpMethod: 'HEAD', path: { parameter: 'path' } },
    { httpMethod: 'POST', path: { parameter: 'path' } },
  ],
  properties: [
    {
      displayName: 'Authentication', name: 'authentication', type: 'options', default: 'none',
      options: [{ name: 'None', value: 'none' }, { name: 'Basic Auth', value: 'basic' }],
    },
    { displayName: 'Form Title', name: 'formTitle', type: 'string', default: '', required: true, placeholder: 'e.g. Contact us' },
    { displayName: 'Form Description', name: 'formDescription', type: 'string', default: '', placeholder: "e.g. We'll get back to you soon", typeOptions: { rows: 3 } },
    formElementsProperty,
    {
      displayName: 'Respond When', name: 'responseMode', type: 'options', default: 'onReceived',
      options: [
        { name: 'Form Is Submitted', value: 'onReceived' },
        { name: 'Workflow Finishes', value: 'lastNode' },
        { name: 'Using Respond to Webhook Node', value: 'responseNode' },
      ],
    },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [
        { name: 'Append Nomops Attribution', value: 'appendAttribution', values: [{ displayName: 'Append Nomops Attribution', name: 'appendAttribution', type: 'boolean', default: true }] },
        { name: 'IP(s) Allowlist', value: 'allowedIps', values: [{ displayName: 'IP(s) Allowlist', name: 'allowedIps', type: 'string', default: '' }] },
        { name: 'Button Label', value: 'buttonLabel', values: [{ displayName: 'Button Label', name: 'buttonLabel', type: 'string', default: 'Submit' }] },
        { name: 'Form Response', value: 'formResponse', values: [
          { displayName: 'Response Title', name: 'responseTitle', type: 'string', default: 'Submitted' },
          { displayName: 'Response Message', name: 'responseMessage', type: 'string', default: 'Your response has been received.' },
        ] },
        { name: 'Ignore Bots', value: 'ignoreBots', values: [{ displayName: 'Ignore Bots', name: 'ignoreBots', type: 'boolean', default: false }] },
        { name: 'Use Workflow Timezone', value: 'useWorkflowTimezone', values: [{ displayName: 'Use Workflow Timezone', name: 'useWorkflowTimezone', type: 'boolean', default: false }] },
        { name: 'Custom Form Styling', value: 'customCss', values: [{ displayName: 'Custom Form Styling', name: 'customCss', type: 'string', default: '', typeOptions: { rows: 6, editor: 'code' } }] },
      ],
    },
    {
      displayName: 'Form Path', name: 'path', type: 'string', default: '', required: true,
      description: 'Production and test form URLs use this path', noDataExpression: true,
      typeOptions: { generateUuid: true },
    },
  ],
};
