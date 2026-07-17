import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { ExecutionPause } from '@nomops/workflow';
import { waitDescription } from './Wait.description.js';

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
};

/**
 * Wait 节点：首跑抛 ExecutionPause 挂起执行（状态序列化落库）；
 * 唤醒后同一帧带 resumed 标记续跑 —— 此时直接把输入透传下游。
 */
export class Wait implements INodeType {
  description = waitDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    if (this.isResumed()) {
      return [this.getInputData()];
    }

    const resume = this.getNodeParameter('resume', 0, 'afterDelay') as string;
    if (resume === 'onSignal') {
      throw new ExecutionPause(); // 无限期等待 resume API
    }

    const amount = Number(this.getNodeParameter('amount', 0, 5));
    const unit = String(this.getNodeParameter('unit', 0, 'seconds'));
    const delayMs = Math.max(0, amount * (UNIT_MS[unit] ?? 1000));
    throw new ExecutionPause({ waitTill: Date.now() + delayMs });
  }
}
