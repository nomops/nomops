import { CronExpressionParser } from 'cron-parser';
import { DateTime } from 'luxon';
import type {
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  ITriggerContext,
  ITriggerResponse,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { scheduleDescription } from './Schedule.description.js';
import { scheduleConfigFromParameters } from '../../lib/schedule-config.js';

/**
 * Schedule 触发节点：trigger() 起定时器，触发时 emit 时间戳 item。
 * ⚠️ 队列模式下只允许 leader 进程调用 trigger()（由 ActiveWorkflowManager 保证）。
 * execute 仅服务手动运行调试。
 */
export class Schedule implements INodeType {
  description = scheduleDescription;

  async trigger(this: ITriggerContext): Promise<ITriggerResponse> {
    const rule = this.getNodeParameter('rule');
    const mode = this.getNodeParameter('mode') ?? 'interval';
    const config = scheduleConfigFromParameters({
      rule,
      mode,
      intervalSeconds: this.getNodeParameter('intervalSeconds') ?? 60,
      cronExpression: this.getNodeParameter('cronExpression') ?? '*/5 * * * *',
    });
    const fire = () => {
      this.emit([[{ json: { timestamp: new Date().toISOString() } }]]);
    };

    if (config.mode === 'cron') {
      const expression = config.cron;
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

    const seconds = config.everySeconds;
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
    const now = DateTime.local();
    return [[{ json: {
      timestamp: now.toISO(),
      'Readable date': now.toFormat('MMMM d yyyy, h:mm:ss a').toLowerCase(),
      'Readable time': now.toFormat('h:mm:ss a').toLowerCase(),
      'Day of week': now.toFormat('cccc'),
      Year: now.toFormat('yyyy'),
      Month: now.toFormat('LLLL'),
      'Day of month': now.toFormat('dd'),
      Hour: now.toFormat('HH'),
      Minute: now.toFormat('mm'),
      Second: now.toFormat('ss'),
      Timezone: now.zoneName,
    } }]];
  }
}
