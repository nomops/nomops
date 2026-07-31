import type { INodeTypeDescription } from '@nomops/workflow';

export const renameKeysDescription: INodeTypeDescription = {
  displayName: 'Rename Keys',
  name: 'renameKeys',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['rename fields'],
  version: 1,
  description: 'Update item field names',
  defaults: { name: 'Rename Keys' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Keys',
      name: 'keys',
      type: 'fixedCollection',
      default: { renames: [] },
      placeholder: 'Add Key',
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Key', layout: 'horizontal' },
      },
      options: [
        {
          name: 'renames',
          value: 'renames',
          values: [
            { displayName: 'Current Key', name: 'currentKey', type: 'string', default: '', required: true },
            { displayName: 'New Key', name: 'newKey', type: 'string', default: '', required: true },
          ],
        },
      ],
    },
    {
      displayName: 'Regex Replacements',
      name: 'regexReplacements',
      type: 'fixedCollection',
      default: { replacements: [] },
      placeholder: 'Add Regex Replacement',
      description: 'Rename matching object keys using a constrained regular expression',
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Regex', layout: 'vertical' },
      },
      options: [
        {
          name: 'replacements',
          value: 'replacements',
          values: [
            { displayName: 'Pattern', name: 'pattern', type: 'string', default: '', required: true },
            { displayName: 'Replace With', name: 'replacement', type: 'string', default: '' },
            { displayName: 'Flags', name: 'flags', type: 'string', default: '', placeholder: 'gi' },
            {
              displayName: 'Max Depth',
              name: 'maxDepth',
              type: 'number',
              default: -1,
              description: '-1 applies recursively without a depth limit; 0 only renames top-level keys',
            },
          ],
        },
      ],
    },
  ],
};
