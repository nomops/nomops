import type { INodeTypeDescription } from '@nomops/workflow';

export const filterDescription: INodeTypeDescription = {
  displayName: 'Filter',
  name: 'filter',
  group: ['transform'],
  categories: ['dataTransformation', 'flow'],
  version: 1,
  description: 'Keep only the items matching the conditions; the rest are discarded',
  defaults: { name: 'Filter' },
  inputs: ['main'],
  outputs: ['main'],
  outputNames: ['Kept', 'Discarded'],
  properties: [
    {
      displayName: 'Conditions',
      name: 'conditions',
      type: 'filter',
      default: {
        combinator: 'and',
        conditions: [],
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      },
      placeholder: 'Add Condition',
      typeOptions: { filter: { valueShape: 'structured', showCombinator: true, addButtonLabel: 'Add condition' } },
    },
    {
      displayName: 'Convert Types Where Required',
      name: 'looseTypeValidation',
      type: 'boolean',
      default: false,
      description: 'Whether to try casting value types based on the selected operator',
    },
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add option',
      options: [{
        name: 'Ignore Case', value: 'ignoreCase', values: [{
          displayName: 'Ignore Case', name: 'ignoreCase', type: 'boolean', default: true,
          description: 'Whether to ignore letter case when evaluating conditions',
        }],
      }],
    },
  ],
};
