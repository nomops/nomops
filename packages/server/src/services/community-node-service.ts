import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { InstalledNode, Repositories } from '@nomops/db';
import type { INodeLoader } from '@nomops/core';
import type { ILoadableNodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

const execFileAsync = promisify(execFile);

/** 合法 npm 包名（可带 scope）。收紧输入，杜绝把奇怪字符喂给 npm。 */
const PKG_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/** 合法版本/dist-tag（semver、范围或 latest 之类）。 */
const VERSION_RE = /^[a-zA-Z0-9.\-+~^><=|* ]+$/;

/**
 * 安装器 seam：真实实现走 npm；测试注入假实现（把包名映射到本地 fixture），无需联网。
 * install/resolveEntry 返回入口模块的绝对路径，交给 service 动态 import。
 */
export interface INodeInstaller {
  install(pkg: string, version?: string): Promise<{ version: string; entryPath: string }>;
  uninstall(pkg: string): Promise<void>;
  resolveEntry(pkg: string): Promise<string>;
}

/** 社区包入口模块约定：导出 `nomopsNodes: ILoadableNodeType[]`（type 会被归一到 <pkg>.<name>）。 */
interface CommunityModule {
  nomopsNodes?: unknown;
}

/** 真实安装器：npm install 到独立节点目录（NOMOPS_COMMUNITY_NODES_DIR）。 */
export class NpmNodeInstaller implements INodeInstaller {
  constructor(private readonly dir: string) {}

  private ensureRoot(): void {
    mkdirSync(this.dir, { recursive: true });
    const pj = join(this.dir, 'package.json');
    // npm --prefix 需要一个 package.json 落脚；没有就建个最小的
    if (!existsSync(pj)) {
      writeFileSync(pj, JSON.stringify({ name: 'nomops-community-nodes', private: true }, null, 2));
    }
  }

  async install(pkg: string, version?: string): Promise<{ version: string; entryPath: string }> {
    this.ensureRoot();
    const spec = version ? `${pkg}@${version}` : pkg;
    await execFileAsync('npm', ['install', spec, '--prefix', this.dir, '--no-audit', '--no-fund', '--save'], {
      timeout: 120_000,
    });
    const entryPath = await this.resolveEntry(pkg);
    const pj = JSON.parse(readFileSync(join(this.dir, 'node_modules', pkg, 'package.json'), 'utf8'));
    return { version: pj.version, entryPath };
  }

  async uninstall(pkg: string): Promise<void> {
    this.ensureRoot();
    await execFileAsync('npm', ['uninstall', pkg, '--prefix', this.dir, '--no-audit', '--no-fund'], {
      timeout: 60_000,
    });
  }

  async resolveEntry(pkg: string): Promise<string> {
    const pkgDir = join(this.dir, 'node_modules', pkg);
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const main =
      (typeof pj.exports === 'string' && pj.exports) ||
      pj.exports?.['.']?.default ||
      pj.exports?.['.']?.import ||
      pj.module ||
      pj.main ||
      'index.js';
    return join(pkgDir, main);
  }
}

/**
 * 社区节点：安装/列出/卸载 npm 节点包，并把其节点注册进加载器。
 * 信任模型：owner 安装，节点代码进程内执行（与 Code 节点同级），故路由限实例 admin。
 * 铁律 5：加载器一视同仁 <pkg>.* 与 nomops.*，引擎/前端不为社区节点写特判。
 */
export class CommunityNodeService {
  constructor(
    private readonly repos: Repositories,
    private readonly nodeLoader: INodeLoader,
    private readonly installer: INodeInstaller,
  ) {}

  async list(): Promise<InstalledNode[]> {
    return this.repos.installedNodes.list();
  }

  async install(pkg: string, version: string | undefined, userId: string | null): Promise<InstalledNode> {
    if (!PKG_NAME_RE.test(pkg)) throw new OperationalError('Invalid package name', { status: 400, pkg });
    if (version !== undefined && !VERSION_RE.test(version)) {
      throw new OperationalError('Invalid version', { status: 400, version });
    }
    const { version: resolved, entryPath } = await this.installer.install(pkg, version);
    const nodes = await this.loadModule(pkg, entryPath);
    return this.repos.installedNodes.upsert({
      packageName: pkg,
      version: resolved,
      nodeTypes: nodes.map((n) => n.type),
      installedBy: userId,
    });
  }

  async uninstall(pkg: string): Promise<void> {
    const existing = await this.repos.installedNodes.findByName(pkg);
    if (!existing) throw new OperationalError('Package not installed', { status: 404, pkg });
    this.nodeLoader.unregister(pkg); // 先摘注册，避免卸载后仍被解析到
    await this.installer.uninstall(pkg);
    await this.repos.installedNodes.delete(pkg);
  }

  /** bootstrap：重载已安装社区包（尽力而为，单包失败只记日志，不崩启动）。 */
  async loadInstalled(): Promise<void> {
    for (const rec of await this.repos.installedNodes.list()) {
      try {
        const entryPath = await this.installer.resolveEntry(rec.packageName);
        await this.loadModule(rec.packageName, entryPath);
      } catch (e) {
        console.warn(`[community-nodes] 重载失败 ${rec.packageName}: ${(e as Error).message}`);
      }
    }
  }

  /** 动态 import 入口 → 校验 nomopsNodes → 归一 type 到 <pkg>.<name> → 注册。 */
  private async loadModule(pkg: string, entryPath: string): Promise<ILoadableNodeType[]> {
    const mod = (await import(pathToFileURL(entryPath).href)) as CommunityModule;
    const raw = mod.nomopsNodes;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new OperationalError(`Package ${pkg} does not export a non-empty "nomopsNodes" array`, {
        status: 400,
        pkg,
      });
    }
    const nodes = raw.map((n) => this.normalize(pkg, n));
    this.nodeLoader.register(nodes);
    return nodes;
  }

  private normalize(pkg: string, n: unknown): ILoadableNodeType {
    const entry = n as Partial<ILoadableNodeType>;
    if (!entry || typeof entry !== 'object' || !entry.description?.name || typeof entry.load !== 'function') {
      throw new OperationalError(`Package ${pkg} has an invalid node (need { description.name, load() })`, {
        status: 400,
        pkg,
      });
    }
    return { type: `${pkg}.${entry.description.name}`, description: entry.description, load: entry.load };
  }
}
