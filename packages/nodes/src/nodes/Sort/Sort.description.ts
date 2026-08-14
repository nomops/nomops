import type { INodeTypeDescription } from '@nomops/workflow';

export const DEFAULT_SORT_CODE = `// The two items to compare are in the variables a and b
// Access the fields in a.json and b.json
// Return -1 if a should go before b
// Return 1 if b should go before a
// Return 0 if there's no difference

fieldName = 'myField';

if (a.json[fieldName] < b.json[fieldName]) {
  return -1;
}
if (a.json[fieldName] > b.json[fieldName]) {
  return 1;
}
return 0;`;

export const sortDescription: INodeTypeDescription = {
  displayName: 'Sort', name: 'sort', group: ['transform'], categories: ['dataTransformation'],
  aliases: ['order items'], version: 1, description: 'Change items order', defaults: { name: 'Sort' },
  inputs: ['main'], outputs: ['main'], properties: [
    { displayName: 'Type', name: 'type', type: 'options', default: 'simple',
      description: 'The type of sorting to perform', options: [
        { name: 'Simple', value: 'simple' }, { name: 'Random', value: 'random' }, { name: 'Code', value: 'code' },
      ] },
    { displayName: 'Fields To Sort By', name: 'sortFieldsUi', type: 'fixedCollection', default: {},
      placeholder: 'Add Field To Sort By', typeOptions: { multipleValues: true, fixedCollection: { addButtonLabel: 'Add Field To Sort By' } },
      displayOptions: { show: { type: ['simple'] } }, options: [{ name: 'sortField', value: 'sortField', values: [
        { displayName: 'Field Name', name: 'fieldName', type: 'string', default: '', required: true, placeholder: 'e.g. id' },
        { displayName: 'Order', name: 'order', type: 'options', default: 'ascending', options: [
          { name: 'Ascending', value: 'ascending' }, { name: 'Descending', value: 'descending' },
        ] },
      ] }] },
    { displayName: 'Code', name: 'code', type: 'string', default: DEFAULT_SORT_CODE,
      description: 'Javascript code to determine the order of any two items', typeOptions: { rows: 10, editor: 'code' },
      displayOptions: { show: { type: ['code'] } } },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, placeholder: 'Add Field',
      displayOptions: { show: { type: ['simple'] } }, options: [{
        name: 'Disable Dot Notation', value: 'disableDotNotation', values: [{
          displayName: 'Disable Dot Notation', name: 'disableDotNotation', type: 'boolean', default: false,
          description: 'Whether to disallow referencing child fields using parent.child in the field name',
        }],
      }] },
    { displayName: 'Legacy Sort Fields', name: 'sortFields', type: 'json', default: {},
      description: 'Legacy workflow compatibility', displayOptions: { hide: { type: ['simple', 'random', 'code'] } } },
    { displayName: 'Legacy Case Sensitive', name: 'caseSensitive', type: 'boolean', default: false,
      description: 'Legacy workflow compatibility', displayOptions: { hide: { type: ['simple', 'random', 'code'] } } },
  ],
};
