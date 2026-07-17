import type { IAiMemory, IAiMessage, INodeType, INodeTypeDescription, ISupplyDataContext } from '@nomops/workflow';

export const windowMemoryDescription: INodeTypeDescription = {
  displayName: 'Window Memory',
  name: 'windowMemory',
  group: ['ai'],
  version: 1,
  description: 'Keep the last N conversation turns in workflow static data',
  defaults: { name: 'Window Memory' },
  inputs: [],
  outputs: ['ai_memory'],
  properties: [
    {
      displayName: 'Window Size (Messages)',
      name: 'windowSize',
      type: 'number',
      default: 20,
      description: 'How many recent messages to keep per session',
    },
  ],
};

/**
 * 滑动窗口记忆子节点：按 sessionId 把最近 N 条消息存进 workflow staticData
 * （server 在执行收尾持久化 staticData，因此跨执行有效）。
 */
export class WindowMemory implements INodeType {
  description = windowMemoryDescription;

  async supplyData(this: ISupplyDataContext): Promise<IAiMemory> {
    const windowSize = Math.max(1, Number(this.getNodeParameter('windowSize', 20)));
    const store = this.getWorkflowStaticData('node');

    return {
      load: async (sessionId: string): Promise<IAiMessage[]> => {
        const sessions = (store['sessions'] ?? {}) as Record<string, IAiMessage[]>;
        return [...(sessions[sessionId] ?? [])];
      },
      save: async (sessionId: string, messages: IAiMessage[]): Promise<void> => {
        const sessions = (store['sessions'] ?? {}) as Record<string, IAiMessage[]>;
        // 只留可序列化字段 + 裁到窗口大小（system 不入库）
        sessions[sessionId] = messages
          .filter((m) => m.role !== 'system')
          .slice(-windowSize)
          .map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
            ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
          }));
        store['sessions'] = sessions;
      },
    };
  }
}
