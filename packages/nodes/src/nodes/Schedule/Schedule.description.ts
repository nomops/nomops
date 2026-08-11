import type { INodeTypeDescription } from '@nomops/workflow';

export const scheduleDescription: INodeTypeDescription = {
  displayName: 'Schedule Trigger',
  name: 'schedule',
  group: ['trigger'],
  categories: ['trigger'],
  version: 1,
  description: 'Runs the flow every day, hour, or custom interval',
  defaults: { name: 'Schedule Trigger' },
  inputs: [],
  outputs: ['main'],
  properties: [
    {
      displayName: 'This workflow will run on the schedule you define here once you publish it. For testing, you can also trigger it manually by going back to the canvas and clicking Execute workflow.',
      name: 'scheduleNotice',
      type: 'notice',
      default: '',
    },
    {
      displayName: 'Trigger Rules',
      name: 'rule',
      type: 'fixedCollection',
      default: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 0, triggerAtMinute: 0 }] },
      typeOptions: {
        multipleValues: true,
        sortable: true,
        fixedCollection: { itemTitle: 'Trigger Interval', addButtonLabel: 'Add Rule', layout: 'vertical' },
      },
      options: [
        {
          name: 'interval',
          value: 'interval',
          values: [
            {
              displayName: 'Trigger Interval',
              name: 'field',
              type: 'options',
              default: 'days',
              options: [
                { name: 'Seconds', value: 'seconds' },
                { name: 'Minutes', value: 'minutes' },
                { name: 'Hours', value: 'hours' },
                { name: 'Days', value: 'days' },
                { name: 'Weeks', value: 'weeks' },
                { name: 'Months', value: 'months' },
                { name: 'Custom (Cron)', value: 'cronExpression' },
              ],
              noDataExpression: true,
            },
            { displayName: 'Seconds Between Triggers', name: 'secondsInterval', type: 'number', default: 30, displayOptions: { show: { field: ['seconds'] } }, noDataExpression: true },
            { displayName: 'Minutes Between Triggers', name: 'minutesInterval', type: 'number', default: 5, displayOptions: { show: { field: ['minutes'] } }, noDataExpression: true },
            { displayName: 'Hours Between Triggers', name: 'hoursInterval', type: 'number', default: 1, displayOptions: { show: { field: ['hours'] } }, noDataExpression: true },
            { displayName: 'Days Between Triggers', name: 'daysInterval', type: 'number', default: 1, displayOptions: { show: { field: ['days'] } }, noDataExpression: true },
            { displayName: 'Weeks Between Triggers', name: 'weeksInterval', type: 'number', default: 1, displayOptions: { show: { field: ['weeks'] } }, noDataExpression: true },
            { displayName: 'Months Between Triggers', name: 'monthsInterval', type: 'number', default: 1, displayOptions: { show: { field: ['months'] } }, noDataExpression: true },
            { displayName: 'Trigger at Hour', name: 'triggerAtHour', type: 'number', default: 0, displayOptions: { show: { field: ['days', 'weeks', 'months'] } }, noDataExpression: true },
            { displayName: 'Trigger at Minute', name: 'triggerAtMinute', type: 'number', default: 0, displayOptions: { show: { field: ['hours', 'days', 'weeks', 'months'] } }, noDataExpression: true },
            { displayName: 'Trigger on Weekday', name: 'triggerAtDay', type: 'options', default: 1, displayOptions: { show: { field: ['weeks'] } }, options: [
              { name: 'Monday', value: 1 }, { name: 'Tuesday', value: 2 }, { name: 'Wednesday', value: 3 }, { name: 'Thursday', value: 4 }, { name: 'Friday', value: 5 }, { name: 'Saturday', value: 6 }, { name: 'Sunday', value: 0 },
            ], noDataExpression: true },
            { displayName: 'Trigger on Day of Month', name: 'triggerAtDayOfMonth', type: 'number', default: 1, displayOptions: { show: { field: ['months'] } }, noDataExpression: true },
            { displayName: 'Expression', name: 'expression', type: 'string', default: '0 0 * * *', placeholder: '0 0 * * *', displayOptions: { show: { field: ['cronExpression'] } }, noDataExpression: true },
          ],
        },
      ],
    },
  ],
};
