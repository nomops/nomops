import type { INodeTypeDescription } from '@nomops/workflow';

export const summarizeDescription: INodeTypeDescription = {
  displayName: 'Summarize',
  name: 'summarize',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['group by', 'aggregate values'],
  version: 1,
  description: 'Group items and calculate summary values',
  defaults: { name: 'Summarize' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Fields To Summarize',
      name: 'aggregations',
      type: 'fixedCollection',
      default: { values: [] },
      required: true,
      placeholder: 'Add Aggregation',
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Aggregation', layout: 'vertical' },
      },
      options: [
        {
          name: 'values',
          value: 'values',
          values: [
            {
              displayName: 'Aggregation',
              name: 'operation',
              type: 'options',
              default: 'count',
              options: [
                { name: 'Sum', value: 'sum' },
                { name: 'Average', value: 'average' },
                { name: 'Count', value: 'count' },
                { name: 'Concatenate', value: 'concatenate' },
              ],
            },
            {
              displayName: 'Field',
              name: 'field',
              type: 'string',
              default: '',
              description: 'Dot path to summarize; Count with an empty field counts all items',
            },
            { displayName: 'Output Field', name: 'outputField', type: 'string', default: '' },
            {
              displayName: 'Separator',
              name: 'separator',
              type: 'string',
              default: ', ',
              description: 'Used by Concatenate',
            },
          ],
        },
      ],
    },
    {
      displayName: 'Fields To Group By',
      name: 'groupBy',
      type: 'string',
      default: '',
      placeholder: 'country, team.id',
      description: 'Comma-separated fields; empty produces one summary item',
    },
  ],
};
