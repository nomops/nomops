import type { INodeTypeDescription } from '@nomops/workflow';

export const splitOutDescription: INodeTypeDescription = {
  displayName: 'Split Out',
  name: 'splitOut',
  group: ['transform'],
  categories: ['dataTransformation'],
  version: 1,
  description: 'Turn a list field inside each item into separate items',
  defaults: { name: 'Split Out' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Fields To Split Out',
      name: 'fieldToSplitOut',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'Drag fields from the left or type their names',
      description: 'Separate multiple field names by commas. For binary data, use $binary.',
    },
    {
      displayName: 'Include',
      name: 'include',
      type: 'options',
      default: 'noOtherFields',
      options: [
        { name: 'No Other Fields', value: 'noOtherFields' },
        { name: 'All Other Fields', value: 'allOtherFields' },
        { name: 'Selected Other Fields', value: 'selectedOtherFields' },
      ],
      description: 'Whether to copy the remaining fields of the source item onto each new item',
    },
    {
      displayName: 'Fields To Include',
      name: 'fieldsToInclude',
      type: 'string',
      default: '',
      placeholder: 'e.g. email, name',
      displayOptions: { show: { include: ['selectedOtherFields'] } },
    },
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add Field',
      options: [
        { name: 'Disable Dot Notation', value: 'disableDotNotation', values: [{
          displayName: 'Disable Dot Notation', name: 'disableDotNotation', type: 'boolean', default: false,
          description: 'Whether to disallow referencing child fields using parent.child in the field name',
        }] },
        { name: 'Destination Field Name', value: 'destinationFieldName', values: [{
          displayName: 'Destination Field Name', name: 'destinationFieldName', type: 'string', default: '',
          description: 'The field in the output under which to put the split field contents',
        }] },
        { name: 'Include Binary', value: 'includeBinary', values: [{
          displayName: 'Include Binary', name: 'includeBinary', type: 'boolean', default: false,
          description: 'Whether to include the binary data in the new items',
        }] },
      ],
    },
    { displayName: 'Destination Field Name', name: 'destinationFieldName', type: 'string', default: '',
      description: 'Legacy workflow compatibility', displayOptions: { hide: { include: ['noOtherFields', 'allOtherFields', 'selectedOtherFields'] } } },
  ],
};
