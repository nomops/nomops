import type { INodeTypeDescription } from '@nomops/workflow';

export const sshDescription: INodeTypeDescription = {
  displayName: 'SSH',
  name: 'ssh',
  group: ['input', 'output'],
  categories: ['core'],
  aliases: ['remote', 'command', 'shell', 'scp'],
  version: 1,
  description: 'Execute commands or transfer files over SSH',
  defaults: { name: 'SSH' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [
    { name: 'sshPassword', required: true, displayOptions: { show: { authentication: ['password'] } } },
    { name: 'sshPrivateKey', required: true, displayOptions: { show: { authentication: ['privateKey'] } } },
  ],
  properties: [
    {
      displayName: 'Authentication', name: 'authentication', type: 'options', default: 'password', noDataExpression: true,
      options: [{ name: 'Password', value: 'password' }, { name: 'Private Key', value: 'privateKey' }],
    },
    {
      displayName: 'Resource', name: 'resource', type: 'options', default: 'command', noDataExpression: true,
      options: [{ name: 'Command', value: 'command' }, { name: 'File', value: 'file' }],
    },
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'execute', noDataExpression: true,
      displayOptions: { show: { resource: ['command'] } },
      options: [{ name: 'Execute', value: 'execute' }],
    },
    {
      displayName: 'Command', name: 'command', type: 'string', default: '', required: true,
      displayOptions: { show: { resource: ['command'], operation: ['execute'] } },
      placeholder: 'uname -a',
    },
    {
      displayName: 'Working Directory', name: 'cwd', type: 'string', default: '',
      displayOptions: { show: { resource: ['command'], operation: ['execute'] } },
      placeholder: '/srv/app',
    },
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'upload', noDataExpression: true,
      displayOptions: { show: { resource: ['file'] } },
      options: [{ name: 'Download', value: 'download' }, { name: 'Upload', value: 'upload' }],
    },
    {
      displayName: 'Remote Path', name: 'path', type: 'string', default: '', required: true,
      displayOptions: { show: { resource: ['file'] } },
      placeholder: '/tmp/file.txt',
    },
    {
      displayName: 'Input Binary Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { resource: ['file'], operation: ['upload'] } },
    },
    {
      displayName: 'Put Output File in Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true,
      displayOptions: { show: { resource: ['file'], operation: ['download'] } },
    },
    { displayName: 'Timeout (ms)', name: 'timeout', type: 'number', default: 30_000, required: true },
  ],
};
