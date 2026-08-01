import type { INodeTypeDescription } from '@nomops/workflow';

export const gitDescription: INodeTypeDescription = {
  displayName: 'Git',
  name: 'git',
  group: ['input', 'output'],
  categories: ['core'],
  aliases: ['repository', 'clone', 'commit', 'push', 'pull'],
  version: 1,
  description: 'Clone and operate a Git repository in the configured workspace',
  defaults: { name: 'Git' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [
    { name: 'gitToken', required: true, displayOptions: { show: { authentication: ['token'] } } },
    { name: 'gitSsh', required: true, displayOptions: { show: { authentication: ['ssh'] } } },
  ],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'status', noDataExpression: true,
      options: [
        { name: 'Clone', value: 'clone' },
        { name: 'Commit', value: 'commit' },
        { name: 'Pull', value: 'pull' },
        { name: 'Push', value: 'push' },
        { name: 'Status', value: 'status' },
      ],
    },
    {
      displayName: 'Authentication', name: 'authentication', type: 'options', default: 'none', noDataExpression: true,
      options: [{ name: 'None', value: 'none' }, { name: 'Access Token', value: 'token' }, { name: 'SSH Key', value: 'ssh' }],
    },
    {
      displayName: 'Repository URL', name: 'repositoryUrl', type: 'string', default: '', required: true,
      displayOptions: { show: { operation: ['clone'] } },
      placeholder: 'https://git.example.com/team/project.git',
    },
    {
      displayName: 'Repository Path', name: 'repositoryPath', type: 'string', default: 'repository', required: true,
      description: 'Relative path inside NOMOPS_GIT_ROOT',
    },
    {
      displayName: 'Branch', name: 'branch', type: 'string', default: '',
      displayOptions: { show: { operation: ['clone', 'pull', 'push'] } },
      placeholder: 'main',
    },
    {
      displayName: 'Remote', name: 'remote', type: 'string', default: 'origin', required: true,
      displayOptions: { show: { operation: ['pull', 'push'] } },
    },
    {
      displayName: 'Commit Message', name: 'message', type: 'string', default: '', required: true,
      displayOptions: { show: { operation: ['commit'] } }, typeOptions: { rows: 3 },
    },
    {
      displayName: 'Author Name', name: 'authorName', type: 'string', default: 'nomops', required: true,
      displayOptions: { show: { operation: ['commit'] } },
    },
    {
      displayName: 'Author Email', name: 'authorEmail', type: 'string', default: 'nomops@localhost', required: true,
      displayOptions: { show: { operation: ['commit'] } },
    },
    { displayName: 'Timeout (ms)', name: 'timeout', type: 'number', default: 120_000, required: true },
  ],
};
