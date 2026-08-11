import type { INodeTypeDescription } from '@nomops/workflow';

export const ifDescription: INodeTypeDescription = {
  displayName: 'IF',
  name: 'if',
  group: ['transform'],
  categories: ['flow'],
  version: 1,
  description: 'Route items to the true or false output based on conditions',
  defaults: { name: 'IF' },
  inputs: ['main'],
  outputs: ['main', 'main'], // 输出0 = true，输出1 = false
  outputNames: ['true', 'false'],
  properties: [
    {
      displayName: 'Conditions',
      name: 'conditions',
      type: 'filter',
      default: [{ left: '', op: 'eq', right: '' }],
      typeOptions: { filter: { addButtonLabel: 'Add condition' } },
    },
    {
      displayName: 'Convert types where required',
      name: 'convertTypes',
      type: 'boolean',
      default: false,
    },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [{
      name: 'Combine Conditions', value: 'combine', values: [{ displayName: 'Combine Conditions', name: 'combine', type: 'options', default: 'and', options: [
        { name: 'AND (All Conditions)', value: 'and' }, { name: 'OR (Any Condition)', value: 'or' },
      ] }],
    }] },
  ],
};
