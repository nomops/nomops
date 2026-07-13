import type {
  ILoadableNodeType,
  INodeType,
  INodeTypeDescription,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 节点加载器契约。
 *
 * 说明：`getByNameAndVersion` 返回 Promise —— 因为 ESM 的动态 import 是异步的，
 * 懒加载必然异步。描述（getAllDescriptions）保持同步，供前端节点面板即时读取。
 */
/** 描述 + 全名类型（前端节点面板 / 校验用；全名规则 nomops.<name> 或 <pkg>.<name>）。 */
export interface INodeTypeInfo extends INodeTypeDescription {
  type: string;
}

export interface INodeLoader {
  loadAll(): Promise<void>;
  getAllDescriptions(): INodeTypeDescription[];
  /** 全部已注册节点的全名类型（去重）；校验节点类型是否已知用。 */
  getAllTypes(): string[];
  /** 描述 + 全名类型（前端节点面板用，社区节点也走这条）。 */
  describeAll(): INodeTypeInfo[];
  getByNameAndVersion(type: string, version?: number): Promise<INodeType>;
  register(nodes: ILoadableNodeType[]): void;
  /** 卸载某个包的全部节点（社区节点用）：移除 registry/版本/实例缓存。 */
  unregister(packageName: string): void;
}

export class NodeTypeNotFoundError extends OperationalError {}

function versionsOf(description: INodeTypeDescription): number[] {
  return Array.isArray(description.version) ? description.version : [description.version];
}

const registryKey = (type: string, version: number): string => `${type}@v${version}`;

/**
 * 懒加载节点加载器。
 * - register 时只登记 description（轻量），不加载类；
 * - getByNameAndVersion 首次用到某节点时才 `load()` 其类并缓存实例。
 */
export class NodeLoader implements INodeLoader {
  private readonly registry = new Map<string, ILoadableNodeType>();
  private readonly latestVersion = new Map<string, number>();
  private readonly instances = new Map<string, INodeType>();

  constructor(sources: ILoadableNodeType[] = []) {
    this.register(sources);
  }

  register(nodes: ILoadableNodeType[]): void {
    for (const node of nodes) {
      for (const version of versionsOf(node.description)) {
        this.registry.set(registryKey(node.type, version), node);
        const current = this.latestVersion.get(node.type);
        if (current === undefined || version > current) {
          this.latestVersion.set(node.type, version);
        }
      }
    }
  }

  async loadAll(): Promise<void> {
    // 描述已在 register 时常驻；类的加载推迟到 getByNameAndVersion（懒加载）。
    // 保留此异步入口用于将来「扫描目录 / 动态发现社区包」。
  }

  getAllDescriptions(): INodeTypeDescription[] {
    return this.uniqueNodes().map((node) => node.description);
  }

  getAllTypes(): string[] {
    return this.uniqueNodes().map((node) => node.type);
  }

  describeAll(): INodeTypeInfo[] {
    return this.uniqueNodes().map((node) => ({ ...node.description, type: node.type }));
  }

  /** registry 里按 type 去重（同一 type 多版本只取一次）。 */
  private uniqueNodes(): ILoadableNodeType[] {
    const seen = new Set<string>();
    const out: ILoadableNodeType[] = [];
    for (const node of this.registry.values()) {
      if (seen.has(node.type)) continue;
      seen.add(node.type);
      out.push(node);
    }
    return out;
  }

  unregister(packageName: string): void {
    const prefix = `${packageName}.`;
    for (const [key, node] of this.registry) {
      if (node.type.startsWith(prefix)) this.registry.delete(key);
    }
    for (const type of this.latestVersion.keys()) {
      if (type.startsWith(prefix)) this.latestVersion.delete(type);
    }
    for (const key of this.instances.keys()) {
      if (key.startsWith(prefix)) this.instances.delete(key);
    }
  }

  async getByNameAndVersion(type: string, version?: number): Promise<INodeType> {
    const resolvedVersion = version ?? this.latestVersion.get(type);
    if (resolvedVersion === undefined) {
      throw new NodeTypeNotFoundError(`未知节点类型: ${type}`, { type });
    }

    const key = registryKey(type, resolvedVersion);
    const cached = this.instances.get(key);
    if (cached) return cached;

    const entry = this.registry.get(key);
    if (!entry) {
      throw new NodeTypeNotFoundError(`节点类型 ${type} 不存在版本 ${resolvedVersion}`, {
        type,
        version: resolvedVersion,
      });
    }

    const NodeClass = await entry.load();
    const instance = new NodeClass();
    this.instances.set(key, instance);
    return instance;
  }
}
