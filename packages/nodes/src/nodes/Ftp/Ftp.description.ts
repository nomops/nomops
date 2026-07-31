import type { INodeTypeDescription } from '@nomops/workflow';

export const ftpDescription: INodeTypeDescription = {
  displayName: 'FTP',
  name: 'ftp',
  group: ['input', 'output'],
  categories: ['core'],
  aliases: ['sftp', 'remote file', 'upload', 'download'],
  version: 1,
  description: 'Upload, download, or list files over FTP and SFTP',
  defaults: { name: 'FTP' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [
    { name: 'ftp', required: true, displayOptions: { show: { protocol: ['ftp'] } } },
    { name: 'sftp', required: true, displayOptions: { show: { protocol: ['sftp'] } } },
  ],
  properties: [
    {
      displayName: 'Protocol', name: 'protocol', type: 'options', default: 'ftp', noDataExpression: true,
      options: [{ name: 'FTP', value: 'ftp' }, { name: 'SFTP', value: 'sftp' }],
    },
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'download', noDataExpression: true,
      options: [{ name: 'Download', value: 'download' }, { name: 'List', value: 'list' }, { name: 'Upload', value: 'upload' }],
    },
    { displayName: 'Path', name: 'path', type: 'string', default: '/', required: true },
    {
      displayName: 'Input Binary Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['upload'] } },
    },
    {
      displayName: 'Put Output File in Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { operation: ['download'] } },
    },
    { displayName: 'Timeout (ms)', name: 'timeout', type: 'number', default: 10000, required: true },
  ],
};
