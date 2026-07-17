import type { ILoadableNodeType, INodeType, INodeTypeDescription } from '@nomops/workflow';

/**
 * 声明式节点工厂：一份 description（含 routing 声明）= 一个可用节点。
 * 节点类没有 execute —— 引擎检测到 routing 声明后走通用 routing 执行器。
 * 加新集成 = 在 integrations.ts 里追加一份纯数据描述。
 */
export function declarative(description: INodeTypeDescription): ILoadableNodeType {
  return {
    type: `nomops.${description.name}`,
    description,
    load: async () =>
      class implements INodeType {
        description = description;
      },
  };
}
