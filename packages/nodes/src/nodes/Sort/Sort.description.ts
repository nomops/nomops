import type { INodeTypeDescription } from '@nomops/workflow';

export const sortDescription: INodeTypeDescription = {
  displayName: 'Sort',
  name: 'sort',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['order items'],
  version: 1,
  description: 'Sort items by one or more fields',
  defaults: { name: 'Sort' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Fields To Sort By',
      name: 'sortFields',
      type: 'fixedCollection',
      default: { fields: [] },
      required: true,
      placeholder: 'Add Field To Sort By',
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Sort Field', layout: 'horizontal' },
      },
      options: [
        {
          name: 'fields',
          value: 'fields',
          values: [
            { displayName: 'Field Name', name: 'fieldName', type: 'string', default: '', required: true },
            {
              displayName: 'Order',
              name: 'direction',
              type: 'options',
              default: 'ascending',
              options: [
                { name: 'Ascending', value: 'ascending' },
                { name: 'Descending', value: 'descending' },
              ],
            },
            {
              displayName: 'Compare As',
              name: 'compareAs',
              type: 'options',
              default: 'auto',
              options: [
                { name: 'Automatic', value: 'auto' },
                { name: 'Number', value: 'number' },
                { name: 'Text', value: 'text' },
                { name: 'Custom Order', value: 'customOrder' },
              ],
            },
            {
              displayName: 'Custom Order',
              name: 'customOrder',
              type: 'string',
              default: '',
              placeholder: 'urgent, normal, low',
              description: 'Comma-separated values used when Compare As is Custom Order',
            },
          ],
        },
      ],
    },
    {
      displayName: 'Case Sensitive',
      name: 'caseSensitive',
      type: 'boolean',
      default: false,
      description: 'Whether text comparisons distinguish uppercase and lowercase characters',
    },
  ],
};
