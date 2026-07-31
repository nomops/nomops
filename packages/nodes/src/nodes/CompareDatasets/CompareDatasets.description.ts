import type { INodeTypeDescription } from '@nomops/workflow';

export const compareDatasetsDescription: INodeTypeDescription = {
  displayName: 'Compare Datasets',
  name: 'compareDatasets',
  group: ['transform'],
  categories: ['dataTransformation', 'flow'],
  aliases: ['diff datasets', 'compare inputs'],
  version: 1,
  description: 'Compare two inputs for matching and changed items',
  defaults: { name: 'Compare Datasets' },
  inputs: ['main', 'main'],
  outputs: ['main', 'main', 'main', 'main'],
  outputNames: ['Only in A', 'Same', 'Different', 'Only in B'],
  properties: [
    {
      displayName: 'Fields To Match',
      name: 'matchFields',
      type: 'fixedCollection',
      default: { values: [] },
      required: true,
      placeholder: 'Add Fields To Match',
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Match Field', layout: 'horizontal' },
      },
      options: [
        {
          name: 'values',
          value: 'values',
          values: [
            { displayName: 'Input A Field', name: 'fieldA', type: 'string', default: '', required: true },
            { displayName: 'Input B Field', name: 'fieldB', type: 'string', default: '', required: true },
          ],
        },
      ],
    },
    {
      displayName: 'Fields To Skip Comparing',
      name: 'skipFields',
      type: 'string',
      default: '',
      placeholder: 'updatedAt, updatedBy',
      description: 'Comma-separated paths ignored after items are matched',
    },
  ],
};
