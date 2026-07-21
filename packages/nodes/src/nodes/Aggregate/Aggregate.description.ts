import type { INodeTypeDescription } from '@nomops/workflow';

export const aggregateDescription: INodeTypeDescription = {
  displayName: 'Aggregate',
  name: 'aggregate',
  group: ['transform'],
  version: 1,
  description: 'Combine all incoming items into a single item',
  defaults: { name: 'Aggregate' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Aggregate',
      name: 'mode',
      type: 'options',
      default: 'allItemData',
      options: [
        { name: 'All Item Data (Into a Single List)', value: 'allItemData' },
        { name: 'Individual Fields', value: 'individualFields' },
      ],
    },
    {
      displayName: 'Put Output in Field',
      name: 'destinationFieldName',
      type: 'string',
      default: 'data',
      description: 'The field to put the list of item JSON into',
      displayOptions: { show: { mode: ['allItemData'] } },
    },
    {
      displayName: 'Fields To Aggregate',
      name: 'fieldsToAggregate',
      type: 'string',
      default: '',
      description: 'Comma-separated dot paths; each becomes a list field on the single output item',
      displayOptions: { show: { mode: ['individualFields'] } },
    },
  ],
};
