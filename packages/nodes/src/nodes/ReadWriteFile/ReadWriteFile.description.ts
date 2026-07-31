import type { INodeTypeDescription } from '@nomops/workflow';

export const readWriteFileDescription: INodeTypeDescription = {
  displayName: 'Read/Write Files from Disk',
  name: 'readWriteFile',
  group: ['input', 'output'],
  categories: ['core'],
  aliases: ['read file', 'write file', 'disk', 'filesystem'],
  version: 1,
  description: 'Read or write files inside the configured local file sandbox',
  defaults: { name: 'Read/Write Files from Disk' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'read', noDataExpression: true,
      options: [
        { name: 'Read File from Disk', value: 'read', description: 'Read one file from the local sandbox' },
        { name: 'Write File to Disk', value: 'write', description: 'Write one binary field to the local sandbox' },
      ],
    },
    {
      displayName: 'File Path', name: 'filePath', type: 'string', default: '', required: true,
      placeholder: 'reports/data.json',
      description: 'Relative path inside NOMOPS_FILES_ROOT',
    },
    {
      displayName: 'Input Binary Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['write'] } },
    },
    {
      displayName: 'Put Output File in Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['read'] } },
    },
    {
      displayName: 'Append', name: 'append', type: 'boolean', default: false,
      displayOptions: { show: { operation: ['write'] } },
    },
  ],
};
