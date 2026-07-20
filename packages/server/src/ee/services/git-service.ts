import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Repositories } from '@nomops/db';
import type { IConnections, INode, IWorkflowSettings } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { WorkflowService } from '../../services/workflow-service.js';

const execFileAsync = promisify(execFile);

const KEY_URL = 'sourceControl.repoUrl';
const KEY_BRANCH = 'sourceControl.branch';
const KEY_CONNECTED = 'sourceControl.connected';
const WORKFLOWS_SUBDIR = 'workflows';

/** 仓库 URL 里若嵌了凭证（https://user:pass@host），掩码后再出 API/日志（铁律 3 延伸）。 */
export function maskRepoUrl(url: string): string {
  return url.replace(/(\/\/)[^/@]+@/, '$1***@');
}

export interface SourceControlConfig {
  connected: boolean;
  repoUrl: string; // 已掩码
  branch: string;
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
  ) {}

  private async git(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', this.workDir, ...args], {
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      throw new OperationalError(`git ${args[0]} failed: ${(err.stderr || err.message || '').trim()}`, {
        status: 400,
      });
    }
  }

  async getConfig(): Promise<SourceControlConfig> {
    const [repoUrl, branch, connected] = await Promise.all([
      this.repos.settings.get(KEY_URL),
      this.repos.settings.get(KEY_BRANCH),
      this.repos.settings.get(KEY_CONNECTED),
    ]);
    return {
      connected: connected === 'true',
      repoUrl: repoUrl ? maskRepoUrl(repoUrl) : '',
      branch: branch || 'main',
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

  /** 连接仓库：clone 到工作目录并切到目标分支；存配置。 */
  async connect(input: { repoUrl: string; branch?: string }): Promise<SourceControlConfig> {
    const repoUrl = input.repoUrl.trim();
    if (!repoUrl) throw new OperationalError('Repository URL is required', { status: 400 });
    const branch = (input.branch || 'main').trim();

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

  /** 导出项目全部工作流到 workflows/<id>.json（键有序，diff 干净）。返回文件名列表。 */
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
    return files;
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

  /** 推送：导出 → add → commit（无改动则跳过）→ push。 */
  async push(input: {
    projectId: string;
    message: string;
    authorName: string;
    authorEmail: string;
  }): Promise<{ committed: boolean; pushed: boolean; files: string[] }> {
    await this.assertConnected();
    const branch = await this.branch();
    const files = await this.exportProject(input.projectId);
    await this.git(['add', '-A']);
    const staged = await this.git(['status', '--porcelain']);
    if (!staged.trim()) return { committed: false, pushed: false, files };
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
    return { committed: true, pushed: true, files };
  }

  /** 拉取：取远端分支 → 硬重置到远端 → 导入工作流文件到项目。 */
  async pull(projectId: string): Promise<{ created: number; updated: number; skipped: string[] }> {
    await this.assertConnected();
    const branch = await this.branch();
    await this.git(['fetch', 'origin', branch]);
    await this.git(['reset', '--hard', `origin/${branch}`]);

    const dir = join(this.workDir, WORKFLOWS_SUBDIR);
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    if (!existsSync(dir)) return { created, updated, skipped };
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
    return { created, updated, skipped };
  }
}
