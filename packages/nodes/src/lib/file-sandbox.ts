import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { OperationalError } from '@nomops/workflow';

function configuredRoot(): string {
  return resolve(process.env['NOMOPS_FILES_ROOT']?.trim() || resolve(process.cwd(), '.nomops', 'files'));
}

function assertRelative(filePath: string): void {
  if (!filePath.trim() || isAbsolute(filePath)) {
    throw new OperationalError('File path must be relative to NOMOPS_FILES_ROOT', {});
  }
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new OperationalError('File path escapes NOMOPS_FILES_ROOT', {});
  }
}

function assertInside(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new OperationalError('File path escapes NOMOPS_FILES_ROOT', {});
  }
}

async function assertNoSymlink(root: string, target: string): Promise<void> {
  const pathFromRoot = relative(root, target);
  let current = root;
  for (const part of pathFromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new OperationalError('Symbolic links are not allowed in file paths', {});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

async function sandboxTarget(filePath: string, write: boolean): Promise<string> {
  assertRelative(filePath);
  const root = configuredRoot();
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const target = resolve(realRoot, filePath);
  assertInside(realRoot, target);
  if (write) await mkdir(dirname(target), { recursive: true });
  await assertNoSymlink(realRoot, target);
  if (write) {
    const realParent = await realpath(dirname(target));
    assertInside(realRoot, realParent);
  } else {
    const realTarget = await realpath(target);
    assertInside(realRoot, realTarget);
  }
  return target;
}

export async function readSandboxFile(filePath: string): Promise<Buffer> {
  const target = await sandboxTarget(filePath, false);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function writeSandboxFile(filePath: string, data: Uint8Array, append: boolean): Promise<void> {
  const target = await sandboxTarget(filePath, true);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (append ? constants.O_APPEND : constants.O_TRUNC);
  const handle = await open(target, flags, 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}
