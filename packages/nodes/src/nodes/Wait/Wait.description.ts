import type { INodeTypeDescription } from '@nomops/workflow';

export const waitDescription: INodeTypeDescription = {
  displayName: 'Wait',
  name: 'wait',
  group: ['transform'],
  categories: ['humanReview', 'flow'],
  version: 1,
  description: 'Pause the execution, then resume after a delay or an external signal',
  defaults: { name: 'Wait' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Resume',
      name: 'resume',
      type: 'options',
      default: 'afterDelay',
      description: 'What wakes the execution up',
      options: [
        { name: 'After a time interval', value: 'afterDelay' },
        // 匿名恢复:任意节点参数里用 {{ $execution.resumeUrl }} 把恢复 URL 发出去(如审批邮件)
        { name: 'On external signal (resume API or $execution.resumeUrl)', value: 'onSignal' },
      ],
    },
    {
      displayName: 'Amount',
      name: 'amount',
      type: 'number',
      default: 5,
      description: 'How long to wait',
      displayOptions: { show: { resume: ['afterDelay'] } },
    },
    {
      displayName: 'Unit',
      name: 'unit',
      type: 'options',
      default: 'seconds',
      options: [
        { name: 'Seconds', value: 'seconds' },
        { name: 'Minutes', value: 'minutes' },
        { name: 'Hours', value: 'hours' },
      ],
      displayOptions: { show: { resume: ['afterDelay'] } },
    },
  ],
};
