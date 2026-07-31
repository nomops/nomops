import type { INodeTypeDescription } from '@nomops/workflow';

export const convertToFileDescription: INodeTypeDescription = {
  displayName: 'Convert to File',
  name: 'convertToFile',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['csv file', 'json file', 'xlsx file', 'base64 to file'],
  version: 1,
  description: 'Convert input items into CSV, JSON, XLSX, or binary files',
  defaults: { name: 'Convert to File' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'csv', noDataExpression: true,
      options: [
        { name: 'Convert to CSV', value: 'csv' },
        { name: 'Convert to JSON', value: 'json' },
        { name: 'Convert to XLSX', value: 'xlsx' },
        { name: 'Move String to File', value: 'binary' },
      ],
    },
    { displayName: 'File Name', name: 'fileName', type: 'string', default: 'data.csv', required: true },
    { displayName: 'Put Output File in Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true },
    {
      displayName: 'Delimiter', name: 'delimiter', type: 'string', default: ',',
      displayOptions: { show: { operation: ['csv'] } },
    },
    {
      displayName: 'Sheet Name', name: 'sheetName', type: 'string', default: 'Sheet1',
      displayOptions: { show: { operation: ['xlsx'] } },
    },
    {
      displayName: 'Source Field', name: 'sourceField', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['binary'] } },
    },
    {
      displayName: 'Source Encoding', name: 'sourceEncoding', type: 'options', default: 'base64',
      displayOptions: { show: { operation: ['binary'] } },
      options: [{ name: 'Base64', value: 'base64' }, { name: 'UTF-8', value: 'utf8' }],
    },
    {
      displayName: 'MIME Type', name: 'mimeType', type: 'string', default: 'application/octet-stream',
      displayOptions: { show: { operation: ['binary'] } },
    },
  ],
};
