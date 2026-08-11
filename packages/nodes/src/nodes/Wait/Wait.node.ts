import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { ExecutionPause } from '@nomops/workflow';
import { waitDescription } from './Wait.description.js';

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
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

    const resume = String(this.getNodeParameter('resume', 0, 'timeInterval'));
    if (['onSignal', 'webhook', 'form'].includes(resume)) {
      const limited = this.getNodeParameter('limitWaitTime', 0, false) === true;
      if (!limited) throw new ExecutionPause();
      const maxAmount = Math.max(0, Number(this.getNodeParameter('maxWaitTime', 0, 1)) || 1);
      const maxUnit = String(this.getNodeParameter('maxWaitTimeUnit', 0, 'hours'));
      throw new ExecutionPause({ waitTill: Date.now() + maxAmount * (UNIT_MS[maxUnit] ?? UNIT_MS['hours']!) });
    }
    if (resume === 'specificTime') {
      const value = this.getNodeParameter('dateTime', 0, '');
      const waitTill = new Date(String(value)).getTime();
      if (!Number.isFinite(waitTill)) throw new Error('Wait: Date and Time is invalid');
      throw new ExecutionPause({ waitTill: Math.max(Date.now(), waitTill) });
    }

    const amount = Number(this.getNodeParameter('amount', 0, 5));
    const unit = String(this.getNodeParameter('unit', 0, 'seconds'));
    const delayMs = Math.max(0, amount * (UNIT_MS[unit] ?? 1000));
    throw new ExecutionPause({ waitTill: Date.now() + delayMs });
  }
}
