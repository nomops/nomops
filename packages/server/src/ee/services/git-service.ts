import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Cipher } from '@nomops/core';
import type { Repositories } from '@nomops/db';
import type { IConnections, INode, IWorkflowSettings } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { WorkflowService } from '../../services/workflow-service.js';

const execFileAsync = promisify(execFile);

const KEY_URL = 'sourceControl.repoUrl';
const KEY_BRANCH = 'sourceControl.branch';
const KEY_CONNECTED = 'sourceControl.connected';
const KEY_CONN_TYPE = 'sourceControl.connectionType'; // 'ssh' | 'https'
const KEY_SSH_PUBLIC = 'sourceControl.sshPublicKey';
const KEY_SSH_PRIVATE_ENC = 'sourceControl.sshPrivateKeyEnc'; // 加密存(铁律 5)
const WORKFLOWS_SUBDIR = 'workflows';
const VARIABLES_FILE = 'variables.json';
const TAGS_FILE = 'tags.json';

export type ConnectionType = 'ssh' | 'https';

/** 仓库 URL 里若嵌了凭证（https://user:pass@host），掩码后再出 API/日志（铁律 3 延伸）。 */
export function maskRepoUrl(url: string): string {
  return url.replace(/(\/\/)[^/@]+@/, '$1***@');
}

export interface SourceControlConfig {
  connected: boolean;
  repoUrl: string; // 已掩码
  branch: string;
  connectionType: ConnectionType;
  sshPublicKey: string; // SSH 模式下的部署公钥(粘进 GitHub);https 模式为空
}

interface WorkflowFile {
  id: string;
  name: string;
  active: boolean;
  nodes: INode[];
  connections: IConnections;
  settings: IWorkflowSettings | null;
}

/**
 * 源码同步：把项目的工作流导出为 git 仓库里的 JSON 文件，
 * push 到远端 / 从远端 pull 导入。只同步工作流——工作流文件本就不含凭证明文（铁律 3 天然满足）。
 * 认证走宿主机 git 配置（SSH 部署密钥 / credential helper）；实例 admin + 企业版门控。
 */
export class GitService {
  constructor(
    private readonly repos: Repositories,
    private readonly workflows: WorkflowService,
    private readonly workDir: string,
    private readonly cipher: Cipher,
  ) {}

  private async connectionType(): Promise<ConnectionType> {
    return (await this.repos.settings.get(KEY_CONN_TYPE)) === 'https' ? 'https' : 'ssh';
  }

  /**
   * 跑 git。SSH 模式:把加密存的部署私钥解密写进临时 0600 文件,
   * 经 GIT_SSH_COMMAND 让本次 git 用它认证,用完即删(明文私钥不常驻磁盘)。
   */
  private async git(args: string[]): Promise<string> {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    let keyDir: string | undefined;
    if ((await this.connectionType()) === 'ssh') {
      const priv = await this.repos.settings.get(KEY_SSH_PRIVATE_ENC);
      if (priv) {
        keyDir = await mkdtemp(join(tmpdir(), 'nomops-sc-'));
        const keyFile = join(keyDir, 'id');
        await writeFile(keyFile, (await this.cipher.decrypt(priv)) + '\n');
        await chmod(keyFile, 0o600);
        env['GIT_SSH_COMMAND'] = `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
      }
    }
    try {
      const { stdout } = await execFileAsync('git', ['-C', this.workDir, ...args], {
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env,
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      throw new OperationalError(`git ${args[0]} failed: ${(err.stderr || err.message || '').trim()}`, {
        status: 400,
      });
    } finally {
      if (keyDir) await rm(keyDir, { recursive: true, force: true });
    }
  }

  /** 生成/取部署 SSH 公钥(ED25519):无则新建一对,私钥加密落库,公钥明存。返回公钥(可粘进 GitHub)。 */
  async ensureSshKey(): Promise<string> {
    const existing = await this.repos.settings.get(KEY_SSH_PUBLIC);
    if (existing) return existing;
    return this.generateSshKey();
  }

  /** 重新生成部署密钥(旧的作废;需在 GitHub 换成新公钥)。 */
  async refreshSshKey(): Promise<string> {
    return this.generateSshKey();
  }

  private async generateSshKey(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nomops-keygen-'));
    try {
      const keyFile = join(dir, 'id_ed25519');
      await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'nomops-deploy-key', '-f', keyFile, '-q'], {
        timeout: 15_000,
      });
      const [priv, pub] = await Promise.all([
        readFile(keyFile, 'utf8'),
        readFile(`${keyFile}.pub`, 'utf8'),
      ]);
      const pubTrimmed = pub.trim();
      await this.repos.settings.set(KEY_SSH_PRIVATE_ENC, await this.cipher.encrypt(priv.trim()), true);
      await this.repos.settings.set(KEY_SSH_PUBLIC, pubTrimmed);
      return pubTrimmed;
    } catch (e) {
      throw new OperationalError(`SSH key generation failed: ${(e as Error).message}`, { status: 500 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async getConfig(): Promise<SourceControlConfig> {
    const [repoUrl, branch, connected, connType, sshPublicKey] = await Promise.all([
      this.repos.settings.get(KEY_URL),
      this.repos.settings.get(KEY_BRANCH),
      this.repos.settings.get(KEY_CONNECTED),
      this.connectionType(),
      this.repos.settings.get(KEY_SSH_PUBLIC),
    ]);
    return {
      connected: connected === 'true',
      repoUrl: repoUrl ? maskRepoUrl(repoUrl) : '',
      branch: branch || 'main',
      connectionType: connType,
      sshPublicKey: connType === 'ssh' ? (sshPublicKey ?? '') : '',
    };
  }

  private async rawRepoUrl(): Promise<string> {
    const url = await this.repos.settings.get(KEY_URL);
    if (!url) throw new OperationalError('Source control is not connected', { status: 400 });
    return url;
  }

  private async branch(): Promise<string> {
    return (await this.repos.settings.get(KEY_BRANCH)) || 'main';
  }

  /** 连接仓库：clone 到工作目录并切到目标分支；存配置。SSH 模式先确保部署密钥就绪。 */
  async connect(input: {
    repoUrl: string;
    branch?: string;
    connectionType?: ConnectionType;
  }): Promise<SourceControlConfig> {
    const repoUrl = input.repoUrl.trim();
    if (!repoUrl) throw new OperationalError('Repository URL is required', { status: 400 });
    const branch = (input.branch || 'main').trim();
    const connType: ConnectionType = input.connectionType === 'https' ? 'https' : 'ssh';

    await this.repos.settings.set(KEY_CONN_TYPE, connType);
    if (connType === 'ssh') await this.ensureSshKey(); // git() 依赖它认证

    await rm(this.workDir, { recursive: true, force: true });
    await mkdir(this.workDir, { recursive: true });
    // clone 到工作目录（. = 当前目录，此前已 -C workDir）
    await this.git(['clone', repoUrl, '.']);
    await this.checkoutBranch(branch);

    await this.repos.settings.set(KEY_URL, repoUrl);
    await this.repos.settings.set(KEY_BRANCH, branch);
    await this.repos.settings.set(KEY_CONNECTED, 'true');
    return this.getConfig();
  }

  async disconnect(): Promise<void> {
    await this.repos.settings.set(KEY_CONNECTED, 'false');
    await this.repos.settings.set(KEY_URL, '');
    await rm(this.workDir, { recursive: true, force: true });
  }

  /** 列远端分支（对标基线的分支下拉）；返回名称列表 + 当前分支。 */
  async listBranches(): Promise<{ branches: string[]; current: string }> {
    await this.assertConnected();
    const out = await this.git(['ls-remote', '--heads', 'origin']);
    const branches = out
      .split('\n')
      .map((l) => l.split('\t')[1])
      .filter((r): r is string => Boolean(r?.startsWith('refs/heads/')))
      .map((r) => r.replace('refs/heads/', ''))
      .sort();
    const current = await this.branch();
    // 当前分支可能是本地未推的新分支，远端列表里没有 → 也纳入
    if (!branches.includes(current)) branches.unshift(current);
    return { branches, current };
  }

  /** 切换分支：fetch → checkout（无则建跟踪）→ reset 到远端。存为新目标分支。 */
  async switchBranch(branch: string): Promise<SourceControlConfig> {
    await this.assertConnected();
    const target = branch.trim();
    if (!target) throw new OperationalError('Branch is required', { status: 400 });
    await this.git(['fetch', 'origin']);
    try {
      await this.git(['checkout', '-B', target, `origin/${target}`]);
    } catch {
      // 远端没有该分支 → 建本地新分支
      await this.git(['checkout', '-B', target]);
    }
    await this.repos.settings.set(KEY_BRANCH, target);
    return this.getConfig();
  }

  /** 切到分支：已存在则 checkout，否则新建（空仓库也可，落到 unborn 分支）。 */
  private async checkoutBranch(branch: string): Promise<void> {
    try {
      await this.git(['checkout', branch]);
    } catch {
      await this.git(['checkout', '-B', branch]);
    }
  }

  private async assertConnected(): Promise<void> {
    if ((await this.repos.settings.get(KEY_CONNECTED)) !== 'true') {
      throw new OperationalError('Source control is not connected', { status: 400 });
    }
    if (!existsSync(join(this.workDir, '.git'))) {
      // 配置在但工作目录没了（重启/换机）：按存的 URL 重新 clone
      await mkdir(this.workDir, { recursive: true });
      await this.git(['clone', await this.rawRepoUrl(), '.']);
      await this.checkoutBranch(await this.branch());
    }
  }

  /**
   * 导出项目到 git 工作树（键有序，diff 干净）：
   * workflows/<id>.json 逐个 + variables.json + tags.json。返回文件名列表。
   * 变量/标签同步（对标基线）——变量值非凭证明文，标签仅名称。
   */
  private async exportProject(projectId: string): Promise<string[]> {
    const dir = join(this.workDir, WORKFLOWS_SUBDIR);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const rows = await this.repos.workflows.findAllByProject(projectId);
    const files: string[] = [];
    for (const wf of rows) {
      const file: WorkflowFile = {
        id: wf.id,
        name: wf.name,
        active: wf.active,
        nodes: wf.nodes,
        connections: wf.connections,
        settings: wf.settings ?? null,
      };
      const name = `${WORKFLOWS_SUBDIR}/${wf.id}.json`;
      await writeFile(join(this.workDir, name), JSON.stringify(file, null, 2) + '\n');
      files.push(name);
    }
    // 变量（key/value，跨环境部署配置）
    const vars = (await this.repos.variables.findAllByProject(projectId))
      .map((v) => ({ key: v.key, value: v.value }))
      .sort((a, b) => a.key.localeCompare(b.key));
    await writeFile(join(this.workDir, VARIABLES_FILE), JSON.stringify(vars, null, 2) + '\n');
    files.push(VARIABLES_FILE);
    // 标签（仅名称）
    const tags = (await this.repos.tags.findAllByProject(projectId))
      .map((t) => ({ name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await writeFile(join(this.workDir, TAGS_FILE), JSON.stringify(tags, null, 2) + '\n');
    files.push(TAGS_FILE);
    return files;
  }

  /** pull 后导入变量（按 key upsert）+ 标签（按 name 新建缺失）。 */
  private async importVariablesAndTags(projectId: string): Promise<{ variables: number; tags: number }> {
    let variables = 0;
    let tags = 0;
    const varsFile = join(this.workDir, VARIABLES_FILE);
    if (existsSync(varsFile)) {
      const parsed = JSON.parse(await readFile(varsFile, 'utf8')) as Array<{ key: string; value: string }>;
      const existing = new Map((await this.repos.variables.findAllByProject(projectId)).map((v) => [v.key, v]));
      for (const v of parsed) {
        if (!v?.key) continue;
        const cur = existing.get(v.key);
        if (!cur) await this.repos.variables.create({ projectId, key: v.key, value: v.value ?? '' });
        else if (cur.value !== v.value) await this.repos.variables.update(cur.id, { value: v.value ?? '' });
        variables++;
      }
    }
    const tagsFile = join(this.workDir, TAGS_FILE);
    if (existsSync(tagsFile)) {
      const parsed = JSON.parse(await readFile(tagsFile, 'utf8')) as Array<{ name: string }>;
      const existing = new Set((await this.repos.tags.findAllByProject(projectId)).map((t) => t.name));
      for (const t of parsed) {
        if (!t?.name) continue;
        if (!existing.has(t.name)) await this.repos.tags.create(projectId, t.name);
        tags++;
      }
    }
    return { variables, tags };
  }

  /** 状态：导出当前项目后对比仓库工作树，列出会提交的改动。 */
  async status(projectId: string): Promise<SourceControlConfig & { files: Array<{ path: string; status: string }> }> {
    const config = await this.getConfig();
    if (!config.connected) return { ...config, files: [] };
    await this.assertConnected();
    await this.exportProject(projectId);
    // -uall：逐个列出未跟踪文件（否则整个新目录会被折叠成 "workflows/"）
    const out = await this.git(['status', '--porcelain', '-uall']);
    const files = out
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
    return { ...config, files };
  }

  /**
   * 推送：导出 → add → commit（无改动则跳过）→ push。
   * files 传了 → 只暂存这些路径（选择性提交，对标基线的 push 勾选）；否则全推。
   */
  async push(input: {
    projectId: string;
    message: string;
    authorName: string;
    authorEmail: string;
    files?: string[];
  }): Promise<{ committed: boolean; pushed: boolean; files: string[] }> {
    await this.assertConnected();
    const branch = await this.branch();
    await this.exportProject(input.projectId);
    if (input.files && input.files.length) {
      // -A + 指定路径:同时暂存该路径的新增/修改/删除
      await this.git(['add', '-A', '--', ...input.files]);
    } else {
      await this.git(['add', '-A']);
    }
    const staged = (await this.git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
    if (!staged.length) return { committed: false, pushed: false, files: [] };
    await this.git([
      '-c',
      `user.name=${input.authorName}`,
      '-c',
      `user.email=${input.authorEmail}`,
      'commit',
      '-m',
      input.message || 'Update workflows',
    ]);
    await this.git(['push', '-u', 'origin', branch]);
    return { committed: true, pushed: true, files: staged };
  }

  /**
   * 拉取预览（对标基线的 pull 确认）：fetch 远端 → 列远端工作流文件，
   * 按项目内是否已存在标为 new/existing。不落库，仅供确认。
   */
  async pullPreview(projectId: string): Promise<{ items: Array<{ id: string; name: string; kind: 'new' | 'existing' }> }> {
    await this.assertConnected();
    const branch = await this.branch();
    await this.git(['fetch', 'origin', branch]);
    const listed = await this.git(['ls-tree', '-r', '--name-only', `origin/${branch}`]).catch(() => '');
    // 文件名即工作流 id（workflows/<id>.json）——按 id 分 new/existing，无需逐个 git show（O(1) git 调用）。
    const ids = listed
      .split('\n')
      .filter((f) => f.startsWith(`${WORKFLOWS_SUBDIR}/`) && f.endsWith('.json'))
      .map((f) => f.slice(WORKFLOWS_SUBDIR.length + 1, -'.json'.length));
    const nameById = new Map(
      (await this.repos.workflows.findAllByProject(projectId)).map((w) => [w.id, w.name]),
    );
    const items = ids.map((id) => ({
      id,
      name: nameById.get(id) ?? id,
      kind: (nameById.has(id) ? 'existing' : 'new') as 'new' | 'existing',
    }));
    // 仅对少量"新"工作流读内容补名称（常见 pull 里新条目很少）。
    for (const item of items.filter((i) => i.kind === 'new')) {
      try {
        const parsed = JSON.parse(await this.git(['show', `origin/${branch}:${WORKFLOWS_SUBDIR}/${item.id}.json`])) as WorkflowFile;
        if (parsed?.name) item.name = parsed.name;
      } catch {
        // 读失败保留 id 作名称
      }
    }
    return { items };
  }

  /** 拉取：取远端分支 → 硬重置到远端 → 导入工作流 + 变量 + 标签到项目。 */
  async pull(projectId: string): Promise<{ created: number; updated: number; skipped: string[]; variables: number; tags: number }> {
    await this.assertConnected();
    const branch = await this.branch();
    await this.git(['fetch', 'origin', branch]);
    await this.git(['reset', '--hard', `origin/${branch}`]);

    const dir = join(this.workDir, WORKFLOWS_SUBDIR);
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    const vt = await this.importVariablesAndTags(projectId);
    if (!existsSync(dir)) return { created, updated, skipped, ...vt };
    for (const name of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as WorkflowFile;
        if (!parsed.id || !Array.isArray(parsed.nodes)) {
          skipped.push(name);
          continue;
        }
        const result = await this.workflows.importFromSync(
          parsed.id,
          {
            name: parsed.name,
            nodes: parsed.nodes,
            connections: parsed.connections ?? {},
            settings: parsed.settings ?? undefined,
          },
          projectId,
        );
        if (result === 'created') created++;
        else updated++;
      } catch {
        skipped.push(name); // 结构非法 / 未知节点类型 → 跳过，不整体失败
      }
    }
    return { created, updated, skipped, ...vt };
  }
}
