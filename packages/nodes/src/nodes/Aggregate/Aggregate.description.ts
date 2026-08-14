import type { INodeTypeDescription } from '@nomops/workflow';

export const aggregateDescription: INodeTypeDescription = {
  displayName: 'Aggregate',
  name: 'aggregate',
  group: ['transform'],
  categories: ['dataTransformation'],
  version: 1,
  description: 'Combine all incoming items into a single item',
  defaults: { name: 'Aggregate' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Aggregate',
      name: 'aggregate',
      type: 'options',
      default: 'aggregateIndividualFields',
      options: [
        { name: 'Individual Fields', value: 'aggregateIndividualFields' },
        { name: 'All Item Data (Into a Single List)', value: 'aggregateAllItemData' },
      ],
    },
    {
      displayName: 'Fields To Aggregate',
      name: 'fieldsToAggregate',
      type: 'fixedCollection',
      typeOptions: { multipleValues: true, fixedCollection: { addButtonLabel: 'Add Field To Aggregate' } },
      default: { fieldToAggregate: [{ fieldToAggregate: '', renameField: false }] },
      displayOptions: { show: { aggregate: ['aggregateIndividualFields'] } },
      options: [{
        name: 'fieldToAggregate', value: 'fieldToAggregate', values: [
          { displayName: 'Input Field Name', name: 'fieldToAggregate', type: 'string', default: '', placeholder: 'e.g. id' },
          { displayName: 'Rename Field', name: 'renameField', type: 'boolean', default: false },
          { displayName: 'Output Field Name', name: 'outputFieldName', type: 'string', default: '',
            displayOptions: { show: { renameField: [true] } } },
        ],
      }],
    },
    {
      displayName: 'Put Output in Field',
      name: 'destinationFieldName',
      type: 'string',
      default: 'data',
      description: 'The field to put the list of item JSON into',
      displayOptions: { show: { aggregate: ['aggregateAllItemData'] } },
    },
    {
      displayName: 'Include', name: 'include', type: 'options', default: 'allFields',
      options: [
        { name: 'All Fields', value: 'allFields' },
        { name: 'Specified Fields', value: 'specifiedFields' },
        { name: 'All Fields Except', value: 'allFieldsExcept' },
      ],
      displayOptions: { show: { aggregate: ['aggregateAllItemData'] } },
    },
    { displayName: 'Fields To Exclude', name: 'fieldsToExclude', type: 'string', default: '', placeholder: 'e.g. email, name',
      displayOptions: { show: { aggregate: ['aggregateAllItemData'], include: ['allFieldsExcept'] } } },
    { displayName: 'Fields To Include', name: 'fieldsToInclude', type: 'string', default: '', placeholder: 'e.g. email, name',
      displayOptions: { show: { aggregate: ['aggregateAllItemData'], include: ['specifiedFields'] } } },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, placeholder: 'Add Field', options: [
        { name: 'Disable Dot Notation', value: 'disableDotNotation', values: [{ displayName: 'Disable Dot Notation', name: 'disableDotNotation', type: 'boolean', default: false,
          displayOptions: { hide: { '/aggregate': ['aggregateAllItemData'] } } }] },
        { name: 'Merge Lists', value: 'mergeLists', values: [{ displayName: 'Merge Lists', name: 'mergeLists', type: 'boolean', default: false,
          displayOptions: { hide: { '/aggregate': ['aggregateAllItemData'] } } }] },
        { name: 'Include Binaries', value: 'includeBinaries', values: [{ displayName: 'Include Binaries', name: 'includeBinaries', type: 'boolean', default: false }] },
        { name: 'Keep Only Unique Binaries', value: 'keepOnlyUnique', values: [{ displayName: 'Keep Only Unique Binaries', name: 'keepOnlyUnique', type: 'boolean', default: false,
          displayOptions: { show: { includeBinaries: [true] } } }] },
        { name: 'Keep Missing And Null Values', value: 'keepMissing', values: [{ displayName: 'Keep Missing And Null Values', name: 'keepMissing', type: 'boolean', default: false,
          displayOptions: { hide: { '/aggregate': ['aggregateAllItemData'] } } }] },
      ],
    },
    {
      displayName: 'Legacy Aggregate Mode',
      name: 'mode',
      type: 'string',
      default: '',
      description: 'Legacy workflow compatibility',
      displayOptions: { hide: { aggregate: ['aggregateIndividualFields', 'aggregateAllItemData'] } },
    },
  ],
};
