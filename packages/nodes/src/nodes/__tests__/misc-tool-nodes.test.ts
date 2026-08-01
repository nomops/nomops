import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { IExecuteContext, INodeExecutionData, JsonObject } from '@nomops/workflow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTotp, verifyTotpCode } from '../../lib/totp.js';
import { ExecutionData } from '../ExecutionData/ExecutionData.node.js';
import { Git } from '../Git/Git.node.js';
import { StopAndError } from '../StopAndError/StopAndError.node.js';
import { Totp } from '../Totp/Totp.node.js';

const execFileAsync = promisify(execFile);
const originalPath = process.env['PATH'];
let root = '';

function context(
  parameters: Record<string, unknown>,
  items: INodeExecutionData[] = [{ json: {} }],
  credentials: Record<string, JsonObject> = {},
): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => name in parameters ? parameters[name] : fallback,
    getCredentials: async (type: string) => credentials[type] ?? {},
  } as unknown as IExecuteContext;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nomops-git-node-'));
  process.env['NOMOPS_GIT_ROOT'] = root;
});

afterEach(async () => {
  process.env['PATH'] = originalPath;
  delete process.env['NOMOPS_GIT_ROOT'];
  await rm(root, { recursive: true, force: true });
});

describe('Stop and Error / Execution Data', () => {
  it('Stop and Error 抛出可序列化受控错误', async () => {
    await expect(new StopAndError().execute!.call(context({
      errorMessage: 'order rejected',
      errorDescription: 'risk rule',
    }))).rejects.toMatchObject({
      message: 'order rejected',
      context: { description: 'risk rule' },
    });
  });

  it('Execution Data 写入、读取单值和读取全部 KV', async () => {
    const set = await new ExecutionData().execute!.call(context(
      { operation: 'set', metadata: { customerId: 'c-42', attempts: 2 } },
      [{ json: { source: true } }],
    ));
    expect(set[0]![0]!.json['_nmMetadata']).toEqual({ customerId: 'c-42', attempts: '2' });

    const get = await new ExecutionData().execute!.call(context(
      { operation: 'get', key: 'customerId', outputField: 'customer' },
      set[0],
    ));
    expect(get[0]![0]!.json['customer']).toBe('c-42');

    const getAll = await new ExecutionData().execute!.call(context(
      { operation: 'getAll', outputField: 'metadata' },
      set[0],
    ));
    expect(getAll[0]![0]!.json['metadata']).toEqual({ customerId: 'c-42', attempts: '2' });
  });
});

describe('TOTP', () => {
  it('符合 RFC 6238 的 SHA1/SHA256/SHA512 标准向量', () => {
    const timestamp = 59_000;
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { timestamp, digits: 8, algorithm: 'sha1' })).toBe('94287082');
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA', { timestamp, digits: 8, algorithm: 'sha256' })).toBe('46119246');
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA', { timestamp, digits: 8, algorithm: 'sha512' })).toBe('90693936');
  });

  it('节点从加密凭证注入 secret，输出只含验证码或校验结果', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const generated = await new Totp().execute!.call(context(
      { operation: 'generate', algorithm: 'sha1', digits: 6, period: 30, window: 1, outputField: 'code' },
      [{ json: { id: 1 } }],
      { totp: { secret } },
    ));
    const code = String(generated[0]![0]!.json['code']);
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(generated)).not.toContain(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);

    const verified = await new Totp().execute!.call(context(
      { operation: 'verify', code, algorithm: 'sha1', digits: 6, period: 30, window: 1, outputField: 'valid' },
      [{ json: {} }],
      { totp: { secret } },
    ));
    expect(verified[0]![0]!.json['valid']).toBe(true);
  });
});

describe('Git', () => {
  it('真实仓库 commit 且禁用仓库 hooks', async () => {
    const repository = join(root, 'repository');
    await mkdir(repository);
    await execFileAsync('git', ['init', '--initial-branch=main', repository]);
    const hookMarker = join(root, 'hook-ran');
    const hook = join(repository, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, `#!/bin/sh\ntouch "${hookMarker}"\n`);
    await chmod(hook, 0o700);
    await writeFile(join(repository, 'README.md'), '# test\n');

    const output = await new Git().execute!.call(context({
      operation: 'commit', authentication: 'none', repositoryPath: 'repository',
      message: 'initial', authorName: 'Nomops Test', authorEmail: 'test@nomops.local', timeout: 30_000,
    }));
    expect(output[0]![0]!.json).toMatchObject({ committed: true, files: ['README.md'] });
    expect((await execFileAsync('git', ['-C', repository, 'log', '-1', '--pretty=%s'])).stdout.trim()).toBe('initial');
    await expect(readFile(hookMarker)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);

  it('token 仅经 askpass 环境注入，失败错误不泄露明文', async () => {
    const fakeBin = join(root, 'bin');
    const capture = join(root, 'args.txt');
    await mkdir(fakeBin);
    const fakeGit = join(fakeBin, 'git');
    await writeFile(fakeGit, `#!/bin/sh\nprintf '%s\\n' "$@" > "${capture}"\nprintf 'remote rejected %s\\n' "$NOMOPS_GIT_TOKEN" >&2\nexit 1\n`);
    await chmod(fakeGit, 0o700);
    process.env['PATH'] = `${fakeBin}:${originalPath ?? ''}`;
    const token = 'git-secret-token-123';

    await expect(new Git().execute!.call(context({
      operation: 'clone', authentication: 'token', repositoryPath: 'clone-target',
      repositoryUrl: 'https://git.example.test/team/repository.git', branch: 'main', timeout: 30_000,
    }, [{ json: {} }], { gitToken: { username: 'automation', accessToken: token } }))).rejects.toThrow('Git operation failed');
    expect(await readFile(capture, 'utf8')).not.toContain(token);
  }, 15_000);

  it('拒绝路径穿越、符号链接与本地 clone URL', async () => {
    await expect(new Git().execute!.call(context({
      operation: 'status', authentication: 'none', repositoryPath: '../outside', timeout: 30_000,
    }))).rejects.toThrow(/NOMOPS_GIT_ROOT/);

    const outside = await mkdtemp(join(tmpdir(), 'nomops-git-outside-'));
    await symlink(outside, join(root, 'link'));
    await expect(new Git().execute!.call(context({
      operation: 'status', authentication: 'none', repositoryPath: 'link/repository', timeout: 30_000,
    }))).rejects.toThrow(/Symbolic links/);
    await rm(outside, { recursive: true, force: true });

    await expect(new Git().execute!.call(context({
      operation: 'clone', authentication: 'none', repositoryPath: 'local-clone',
      repositoryUrl: '/tmp/repository.git', branch: '', timeout: 30_000,
    }))).rejects.toThrow(/HTTPS or SSH/);
  });
});
