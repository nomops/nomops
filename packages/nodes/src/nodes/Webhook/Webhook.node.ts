import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { webhookDescription } from './Webhook.description.js';

/**
 * Webhook 触发节点。真实触发时 server 用请求内容构造种子数据从本节点起跑；
 * execute 仅服务「手动运行调试」：播一个示例请求形状的 item。
 */
export class Webhook implements INodeType {
  description = webhookDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: { body: {}, query: {}, headers: {}, note: 'Sample webhook data from a manual run' } }]];
  }
}
