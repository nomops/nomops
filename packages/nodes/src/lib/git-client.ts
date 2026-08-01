import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { OperationalError } from '@nomops/workflow';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const referenceSchema = z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);

export type GitAuthentication =
  | { type: 'none' }
  | { type: 'token'; username: string; token: string }
  | { type: 'ssh'; privateKey: string; passphrase?: string; knownHosts?: string };

interface IGitRunOptions {
  cwd: string;
  args: string[];
  authentication: GitAuthentication;
  timeoutMs: number;
}

function configuredRoot(): string {
  return resolve(process.env['NOMOPS_GIT_ROOT']?.trim() || resolve(process.cwd(), '.nomops', 'git'));
}

function assertRelative(repositoryPath: string): void {
  const normalized = repositoryPath.trim().replaceAll('\\', '/');
  if (!normalized || normalized === '.' || isAbsolute(normalized) || normalized.split('/').some((part) => part === '..')) {
    throw new OperationalError('Repository path must be relative to NOMOPS_GIT_ROOT', {});
  }
  if (normalized.split('/').some((part) => !part || part.startsWith('-'))) {
    throw new OperationalError('Repository path contains an invalid segment', {});
  }
}

function assertInside(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new OperationalError('Repository path escapes NOMOPS_GIT_ROOT', {});
  }
}

async function assertNoSymlink(root: string, target: string): Promise<void> {
  const pathFromRoot = relative(root, target);
  let current = root;
  for (const part of pathFromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new OperationalError('Symbolic links are not allowed in repository paths', {});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export async function resolveGitRepositoryPath(repositoryPath: string, mustExist: boolean): Promise<string> {
  assertRelative(repositoryPath);
  const root = configuredRoot();
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const target = resolve(realRoot, repositoryPath);
  assertInside(realRoot, target);
  await assertNoSymlink(realRoot, target);
  if (mustExist) {
    const realTarget = await realpath(target).catch(() => {
      throw new OperationalError('Git repository does not exist', {});
    });
    assertInside(realRoot, realTarget);
    const gitDirectory = resolve(realTarget, '.git');
    const stat = await lstat(gitDirectory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new OperationalError('Path is not a Git repository', {});
    return realTarget;
  }
  await mkdir(dirname(target), { recursive: true });
  const realParent = await realpath(dirname(target));
  assertInside(realRoot, realParent);
  try {
    await lstat(target);
    throw new OperationalError('Clone target already exists', {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}

export function validateGitRepositoryUrl(repositoryUrl: string, authentication: GitAuthentication): string {
  const value = repositoryUrl.trim();
  if (!value || value.startsWith('-') || /[\r\n\0]/.test(value)) {
    throw new OperationalError('Git repository URL is invalid', {});
  }
  if (value.startsWith('https://') || value.startsWith('ssh://')) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new OperationalError('Git repository URL is invalid', {});
    }
    if (!parsed.hostname || parsed.password) throw new OperationalError('Git repository URL must not contain a password', {});
    if (authentication.type === 'token' && parsed.protocol !== 'https:') {
      throw new OperationalError('Token authentication requires an HTTPS repository URL', {});
    }
    if (authentication.type === 'ssh' && parsed.protocol !== 'ssh:') {
      throw new OperationalError('SSH authentication requires an SSH repository URL', {});
    }
    return value;
  }
  if (authentication.type !== 'ssh' || !/^(?:[^@\s/:]+@)?[A-Za-z0-9.-]+:[^\s]+$/.test(value)) {
    throw new OperationalError('Repository URL must use HTTPS or SSH', {});
  }
  return value;
}

function shellScript(lines: string[]): string {
  return `#!/bin/sh\n${lines.join('\n')}\n`;
}

async function prepareAuthentication(authentication: GitAuthentication): Promise<{
  directory: string;
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), 'nomops-git-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
  };
  if (authentication.type === 'token') {
    const askPass = resolve(directory, 'askpass');
    await writeFile(askPass, shellScript([
      'case "$1" in',
      '  *Username*) printf "%s\\n" "$NOMOPS_GIT_USERNAME" ;;',
      '  *) printf "%s\\n" "$NOMOPS_GIT_TOKEN" ;;',
      'esac',
    ]), { mode: 0o700, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
    env['GIT_ASKPASS'] = askPass;
    env['NOMOPS_GIT_USERNAME'] = authentication.username;
    env['NOMOPS_GIT_TOKEN'] = authentication.token;
  } else if (authentication.type === 'ssh') {
    const keyFile = resolve(directory, 'id');
    const askPass = resolve(directory, 'askpass');
    const ssh = resolve(directory, 'ssh');
    await writeFile(keyFile, `${authentication.privateKey.trim()}\n`, { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
    await writeFile(askPass, shellScript(['printf "%s\\n" "$NOMOPS_GIT_PASSPHRASE"']), { mode: 0o700, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
    const sshArguments = [
      'exec ssh -i "$NOMOPS_GIT_KEY_FILE" -o IdentitiesOnly=yes',
      '-o BatchMode=no -o ConnectTimeout=15',
      authentication.knownHosts?.trim()
        ? '-o StrictHostKeyChecking=yes -o UserKnownHostsFile="$NOMOPS_GIT_KNOWN_HOSTS_FILE"'
        : '-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$NOMOPS_GIT_KNOWN_HOSTS_FILE"',
      '"$@"',
    ];
    const knownHostsFile = resolve(directory, 'known_hosts');
    await writeFile(knownHostsFile, authentication.knownHosts?.trim() ?? '', { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
    await writeFile(ssh, shellScript([sshArguments.join(' ')]), { mode: 0o700, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
    await chmod(keyFile, 0o600);
    env['GIT_SSH'] = ssh;
    env['SSH_ASKPASS'] = askPass;
    env['SSH_ASKPASS_REQUIRE'] = 'force';
    env['DISPLAY'] = 'nomops';
    env['NOMOPS_GIT_KEY_FILE'] = keyFile;
    env['NOMOPS_GIT_KNOWN_HOSTS_FILE'] = knownHostsFile;
    env['NOMOPS_GIT_PASSPHRASE'] = authentication.passphrase ?? '';
  }
  return {
    directory,
    env,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function runGit(options: IGitRunOptions): Promise<string> {
  const auth = await prepareAuthentication(options.authentication);
  const guardedArgs = [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'protocol.file.allow=never',
    '-c', 'protocol.ext.allow=never',
    '-C', options.cwd,
    ...options.args,
  ];
  try {
    const { stdout } = await execFileAsync('git', guardedArgs, {
      env: auth.env,
      timeout: options.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const processError = error as { killed?: boolean; signal?: string };
    if (processError.killed || processError.signal === 'SIGTERM') {
      throw new OperationalError('Git operation timed out', {});
    }
    throw new OperationalError('Git operation failed', {});
  } finally {
    await auth.cleanup();
  }
}

export function validateGitReference(value: string, label: string): string {
  const parsed = referenceSchema.safeParse(value);
  if (!parsed.success || parsed.data.includes('..') || parsed.data.endsWith('/') || parsed.data.includes('//')) {
    throw new OperationalError(`${label} is invalid`, {});
  }
  return parsed.data;
}

export async function cloneGitRepository(input: {
  repositoryUrl: string;
  repositoryPath: string;
  branch?: string;
  authentication: GitAuthentication;
  timeoutMs: number;
}): Promise<void> {
  const target = await resolveGitRepositoryPath(input.repositoryPath, false);
  const parent = dirname(target);
  const repositoryUrl = validateGitRepositoryUrl(input.repositoryUrl, input.authentication);
  const branch = input.branch?.trim() ? validateGitReference(input.branch, 'Branch') : undefined;
  await runGit({
    cwd: parent,
    authentication: input.authentication,
    timeoutMs: input.timeoutMs,
    args: ['clone', ...(branch ? ['--branch', branch] : []), '--', repositoryUrl, basename(target)],
  });
}
