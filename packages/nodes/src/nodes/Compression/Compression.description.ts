import type { INodeTypeDescription } from '@nomops/workflow';

export const compressionDescription: INodeTypeDescription = {
  displayName: 'Compression',
  name: 'compression',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['zip', 'unzip', 'gzip', 'gunzip', 'archive'],
  version: 1,
  description: 'Compress and decompress ZIP or Gzip files',
  defaults: { name: 'Compression' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'compress', noDataExpression: true,
      options: [{ name: 'Compress', value: 'compress' }, { name: 'Decompress', value: 'decompress' }],
    },
    {
      displayName: 'Input Binary Field(s)', name: 'binaryPropertyNames', type: 'string', default: 'data', required: true,
      description: 'Comma-separated binary field names',
    },
    {
      displayName: 'Output Format', name: 'outputFormat', type: 'options', default: 'zip',
      displayOptions: { show: { operation: ['compress'] } },
      options: [{ name: 'ZIP', value: 'zip' }, { name: 'Gzip', value: 'gzip' }],
    },
    {
      displayName: 'File Name', name: 'fileName', type: 'string', default: 'archive.zip', required: true,
      displayOptions: { show: { operation: ['compress'] } },
    },
    {
      displayName: 'Put Output File in Field', name: 'outputField', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['compress'] } },
    },
    {
      displayName: 'Output Prefix', name: 'outputPrefix', type: 'string', default: 'file_', required: true,
      displayOptions: { show: { operation: ['decompress'] } },
    },
  ],
};
