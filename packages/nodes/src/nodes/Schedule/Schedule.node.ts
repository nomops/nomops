import { CronExpressionParser } from 'cron-parser';
import type {
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  ITriggerContext,
  ITriggerResponse,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { scheduleDescription } from './Schedule.description.js';

/**
 * Schedule 触发节点：trigger() 起定时器，触发时 emit 时间戳 item。
 * ⚠️ 队列模式下只允许 leader 进程调用 trigger()（由 ActiveWorkflowManager 保证）。
 * execute 仅服务手动运行调试。
 */
export class Schedule implements INodeType {
  description = scheduleDescription;

  async trigger(this: ITriggerContext): Promise<ITriggerResponse> {
    const mode = (this.getNodeParameter('mode') ?? 'interval') as string;
    const fire = () => {
      this.emit([[{ json: { timestamp: new Date().toISOString() } }]]);
    };

    if (mode === 'cron') {
      const expression = String(this.getNodeParameter('cronExpression') ?? '');
      let interval;
      try {
        interval = CronExpressionParser.parse(expression);
      } catch (error) {
        throw new OperationalError(`Invalid cron expression: ${expression}`, {
          cause: (error as Error).message,
        });
      }
      let timer: NodeJS.Timeout | null = null;
      let stopped = false;
      const scheduleNext = () => {
        if (stopped) return;
        const wait = Math.max(0, interval.next().getTime() - Date.now());
        timer = setTimeout(() => {
          fire();
          scheduleNext();
        }, wait);
      };
      scheduleNext();
      return {
        closeFunction: async () => {
          stopped = true;
          if (timer) clearTimeout(timer);
        },
      };
    }

    const seconds = Number(this.getNodeParameter('intervalSeconds') ?? 60);
    if (!(seconds > 0)) {
      throw new OperationalError(`Interval must be a positive number, got ${seconds}`);
    }
    const timer = setInterval(fire, seconds * 1000);
    return {
      closeFunction: async () => clearInterval(timer),
    };
  }

  /** 手动运行调试：播一个当前时间 item。 */
  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: { timestamp: new Date().toISOString(), note: 'Manual run' } }]];
  }
}
