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
export interface INodeLoader {
  loadAll(): Promise<void>;
  getAllDescriptions(): INodeTypeDescription[];
  getByNameAndVersion(type: string, version?: number): Promise<INodeType>;
  register(nodes: ILoadableNodeType[]): void;
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
    const seen = new Set<string>();
    const descriptions: INodeTypeDescription[] = [];
    for (const node of this.registry.values()) {
      if (seen.has(node.type)) continue;
      seen.add(node.type);
      descriptions.push(node.description);
    }
    return descriptions;
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
