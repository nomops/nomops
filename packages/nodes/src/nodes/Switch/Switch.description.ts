import type { INodeTypeDescription } from '@nomops/workflow';

export const switchDescription: INodeTypeDescription = {
  displayName: 'Switch',
  name: 'switch',
  group: ['transform'],
  categories: ['dataTransformation', 'flow'],
  version: 1,
  description: 'Route items depending on defined expression or rules',
  defaults: { name: 'Switch' },
  inputs: ['main'],
  outputs: ['main', 'main', 'main', 'main'],
  outputNames: ['0', '1', '2', '3'],
  properties: [
    { displayName: 'Mode', name: 'mode', type: 'options', default: 'rules', options: [
      { name: 'Rules', value: 'rules' }, { name: 'Expression', value: 'expression' },
    ], noDataExpression: true },
    {
      displayName: 'Routing Rules',
      name: 'rules',
      type: 'filter',
      default: [{ left: '', op: 'eq', right: '', outputName: '' }],
      typeOptions: { filter: { itemTitle: 'Routing Rule', addButtonLabel: 'Add Routing Rule', maxConditions: 4, showRenameOutput: true } },
      displayOptions: { show: { mode: ['rules'] } },
    },
    { displayName: 'Output Index', name: 'output', type: 'number', default: 0, description: 'The zero-based output index for this item', displayOptions: { show: { mode: ['expression'] } } },
    { displayName: 'Convert types where required', name: 'convertTypes', type: 'boolean', default: false, displayOptions: { show: { mode: ['rules'] } } },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [{ name: 'Fallback Output', value: 'fallbackOutput', values: [{
        displayName: 'Fallback Output', name: 'fallbackOutput', type: 'options', default: 'none', options: [
          { name: 'None (Discard Item)', value: 'none' }, { name: 'Output 0', value: '0' }, { name: 'Output 1', value: '1' }, { name: 'Output 2', value: '2' }, { name: 'Output 3', value: '3' },
        ], description: 'Where to send items that match no rule',
      }] }],
    },
  ],
};
