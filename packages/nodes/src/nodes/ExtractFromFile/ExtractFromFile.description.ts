import type { INodeTypeDescription } from '@nomops/workflow';

export const extractFromFileDescription: INodeTypeDescription = {
  displayName: 'Extract from File',
  name: 'extractFromFile',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['parse csv', 'parse json', 'parse xlsx', 'extract pdf', 'read text'],
  version: 1,
  description: 'Extract items from CSV, JSON, XLSX, PDF, or text files',
  defaults: { name: 'Extract from File' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'csv', noDataExpression: true,
      options: [
        { name: 'Extract from CSV', value: 'csv' },
        { name: 'Extract from JSON', value: 'json' },
        { name: 'Extract from XLSX', value: 'xlsx' },
        { name: 'Extract from PDF', value: 'pdf' },
        { name: 'Extract from Text File', value: 'text' },
      ],
    },
    { displayName: 'Input Binary Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true },
    {
      displayName: 'Delimiter', name: 'delimiter', type: 'string', default: ',',
      displayOptions: { show: { operation: ['csv'] } },
    },
    {
      displayName: 'Sheet Name', name: 'sheetName', type: 'string', default: '',
      displayOptions: { show: { operation: ['xlsx'] } },
    },
    {
      displayName: 'Output Field', name: 'outputField', type: 'string', default: 'text', required: true,
      displayOptions: { show: { operation: ['pdf', 'text'] } },
    },
  ],
};
