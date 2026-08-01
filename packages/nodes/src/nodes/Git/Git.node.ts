import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { z } from 'zod';
import {
  cloneGitRepository,
  type GitAuthentication,
  resolveGitRepositoryPath,
  runGit,
  validateGitReference,
} from '../../lib/git-client.js';
import { gitDescription } from './Git.description.js';

const operationSchema = z.enum(['clone', 'status', 'commit', 'pull', 'push']);
const authenticationSchema = z.enum(['none', 'token', 'ssh']);
const timeoutSchema = z.number().int().min(1_000).max(600_000);
const textSchema = z.string().trim().min(1).max(10_000);
const emailSchema = z.string().trim().email().max(320);

async function authenticationFor(context: IExecuteContext, type: z.infer<typeof authenticationSchema>): Promise<GitAuthentication> {
  if (type === 'none') return { type: 'none' };
  const credentials = await context.getCredentials(type === 'token' ? 'gitToken' : 'gitSsh');
  if (type === 'token') {
    const username = z.string().trim().min(1).max(256).safeParse(credentials['username']);
    const token = z.string().min(1).max(20_000).safeParse(credentials['accessToken']);
    if (!username.success || !token.success) throw new OperationalError('Git token credential is invalid', {});
    return { type, username: username.data, token: token.data };
  }
  const privateKey = z.string().min(1).max(100_000).safeParse(credentials['privateKey']);
  if (!privateKey.success) throw new OperationalError('Git SSH credential is invalid', {});
  return {
    type,
    privateKey: privateKey.data,
    passphrase: typeof credentials['passphrase'] === 'string' ? credentials['passphrase'] : undefined,
    knownHosts: typeof credentials['knownHosts'] === 'string' ? credentials['knownHosts'] : undefined,
  };
}

function parseRequired(value: unknown, label: string): string {
  const parsed = textSchema.safeParse(value);
  if (!parsed.success) throw new OperationalError(`${label} is required`, {});
  return parsed.data;
}

export class Git implements INodeType {
  description = gitDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of this.getInputData().entries()) {
      const parsedOperation = operationSchema.safeParse(this.getNodeParameter('operation', itemIndex, 'status'));
      const parsedAuthentication = authenticationSchema.safeParse(this.getNodeParameter('authentication', itemIndex, 'none'));
      const parsedTimeout = timeoutSchema.safeParse(this.getNodeParameter('timeout', itemIndex, 120_000));
      if (!parsedOperation.success || !parsedAuthentication.success || !parsedTimeout.success) {
        throw new OperationalError('Git parameters are invalid', {});
      }
      const repositoryPath = parseRequired(this.getNodeParameter('repositoryPath', itemIndex, ''), 'Repository path');
      const authentication = await authenticationFor(this, parsedAuthentication.data);
      let result: JsonObject;
      if (parsedOperation.data === 'clone') {
        await cloneGitRepository({
          repositoryUrl: parseRequired(this.getNodeParameter('repositoryUrl', itemIndex, ''), 'Repository URL'),
          repositoryPath,
          branch: String(this.getNodeParameter('branch', itemIndex, '')),
          authentication,
          timeoutMs: parsedTimeout.data,
        });
        result = { success: true, operation: 'clone', repositoryPath };
      } else {
        const cwd = await resolveGitRepositoryPath(repositoryPath, true);
        if (parsedOperation.data === 'status') {
          const status = await runGit({ cwd, args: ['status', '--porcelain=v1', '-uall'], authentication, timeoutMs: parsedTimeout.data });
          const files = status.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));
          result = { clean: files.length === 0, files };
        } else if (parsedOperation.data === 'commit') {
          const message = parseRequired(this.getNodeParameter('message', itemIndex, ''), 'Commit message');
          const authorName = parseRequired(this.getNodeParameter('authorName', itemIndex, ''), 'Author name');
          const authorEmail = emailSchema.safeParse(this.getNodeParameter('authorEmail', itemIndex, ''));
          if (!authorEmail.success) throw new OperationalError('Author email is invalid', {});
          await runGit({ cwd, args: ['add', '-A'], authentication, timeoutMs: parsedTimeout.data });
          const staged = await runGit({ cwd, args: ['diff', '--cached', '--name-only'], authentication, timeoutMs: parsedTimeout.data });
          if (!staged) result = { committed: false, files: [] };
          else {
            await runGit({
              cwd,
              args: ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail.data}`, 'commit', '-m', message],
              authentication,
              timeoutMs: parsedTimeout.data,
            });
            result = { committed: true, files: staged.split('\n').filter(Boolean) };
          }
        } else {
          const remote = validateGitReference(String(this.getNodeParameter('remote', itemIndex, 'origin')), 'Remote');
          const branchRaw = String(this.getNodeParameter('branch', itemIndex, '')).trim();
          const branch = branchRaw ? validateGitReference(branchRaw, 'Branch') : undefined;
          const args = parsedOperation.data === 'push'
            ? ['push', ...(branch ? ['-u', remote, branch] : [remote])]
            : ['pull', '--ff-only', remote, ...(branch ? [branch] : [])];
          await runGit({ cwd, args, authentication, timeoutMs: parsedTimeout.data });
          result = { success: true, operation: parsedOperation.data, remote, ...(branch ? { branch } : {}) };
        }
      }
      output.push({ json: { ...item.json, ...result }, binary: item.binary, pairedItem: { item: itemIndex } });
    }
    return [output];
  }
}
