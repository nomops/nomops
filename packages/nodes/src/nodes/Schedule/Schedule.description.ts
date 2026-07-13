import type { INodeTypeDescription } from '@nomops/workflow';

export const scheduleDescription: INodeTypeDescription = {
  displayName: 'Schedule',
  name: 'schedule',
  group: ['trigger'],
  version: 1,
  description: 'Trigger the workflow on a schedule (interval or cron; active only when the workflow is active)',
  defaults: { name: 'Schedule' },
  inputs: [],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Mode',
      name: 'mode',
      type: 'options',
      default: 'interval',
      options: [
        { name: 'Fixed interval', value: 'interval' },
        { name: 'Cron expression', value: 'cron' },
      ],
      noDataExpression: true,
    },
    {
      displayName: 'Interval (seconds)',
      name: 'intervalSeconds',
      type: 'number',
      default: 60,
      displayOptions: { show: { mode: ['interval'] } },
      noDataExpression: true,
    },
    {
      displayName: 'Cron Expression',
      name: 'cronExpression',
      type: 'string',
      default: '*/5 * * * *',
      placeholder: '*/5 * * * *',
      displayOptions: { show: { mode: ['cron'] } },
      noDataExpression: true,
    },
  ],
};
