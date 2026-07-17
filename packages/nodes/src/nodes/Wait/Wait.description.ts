import type { INodeTypeDescription } from '@nomops/workflow';

export const waitDescription: INodeTypeDescription = {
  displayName: 'Wait',
  name: 'wait',
  group: ['transform'],
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
        { name: 'On external signal (resume API)', value: 'onSignal' },
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
