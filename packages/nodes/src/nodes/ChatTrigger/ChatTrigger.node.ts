import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { chatTriggerDescription } from './ChatTrigger.description.js';

/**
 * 聊天触发起点：把 chat 端点播种的消息 items（{ chatInput, sessionId }）原样交给下游。
 * 手动点 Execute（无消息）时播一个空消息，方便画布调试。
 */
export class ChatTrigger implements INodeType {
  description = chatTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const seeded = this.getInputData();
    const hasMessage = seeded.some((item) => item.json['chatInput'] !== undefined);
    return [hasMessage ? seeded : [{ json: { chatInput: '', sessionId: 'manual' } }]];
  }
}
