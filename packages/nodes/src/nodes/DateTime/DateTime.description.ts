import type { INodeProperties, INodeTypeDescription } from '@nomops/workflow';

const dateInput: INodeProperties = {
  displayName: 'Date',
  name: 'date',
  type: 'string',
  default: '',
  required: true,
  description: 'Date value to parse or manipulate',
};

const timezone: INodeProperties = {
  displayName: 'Timezone',
  name: 'timezone',
  type: 'string',
  default: 'UTC',
  required: true,
  placeholder: 'Asia/Shanghai',
  description: 'IANA timezone used to interpret and output the date',
};

const outputField: INodeProperties = {
  displayName: 'Output Field',
  name: 'outputField',
  type: 'string',
  default: 'date',
  required: true,
  description: 'Field that receives the resulting date value',
};

export const dateTimeDescription: INodeTypeDescription = {
  displayName: 'Date & Time',
  name: 'dateTime',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['date', 'time', 'timezone', 'format date'],
  version: 1,
  description: 'Parse, format, add to, or subtract from date values',
  defaults: { name: 'Date & Time' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'parse',
      noDataExpression: true,
      options: [
        { name: 'Parse Date', value: 'parse' },
        { name: 'Format Date', value: 'format' },
        { name: 'Add to Date', value: 'add' },
        { name: 'Subtract from Date', value: 'subtract' },
      ],
    },
    dateInput,
    {
      displayName: 'Input Format',
      name: 'inputFormat',
      type: 'options',
      default: 'iso',
      displayOptions: { show: { operation: ['parse'] } },
      options: [
        { name: 'ISO 8601', value: 'iso' },
        { name: 'Custom Format', value: 'custom' },
        { name: 'Unix Timestamp (Seconds)', value: 'unixSeconds' },
        { name: 'Unix Timestamp (Milliseconds)', value: 'unixMilliseconds' },
      ],
    },
    {
      displayName: 'Custom Input Format',
      name: 'customInputFormat',
      type: 'string',
      default: 'yyyy-MM-dd HH:mm:ss',
      required: true,
      displayOptions: { show: { operation: ['parse'], inputFormat: ['custom'] } },
      description: 'Luxon-style format used to parse the input',
    },
    {
      displayName: 'Output Format',
      name: 'outputFormat',
      type: 'options',
      default: 'iso',
      displayOptions: { show: { operation: ['format'] } },
      options: [
        { name: 'ISO 8601', value: 'iso' },
        { name: 'Custom Format', value: 'custom' },
        { name: 'Unix Timestamp (Seconds)', value: 'unixSeconds' },
        { name: 'Unix Timestamp (Milliseconds)', value: 'unixMilliseconds' },
      ],
    },
    {
      displayName: 'Custom Output Format',
      name: 'customOutputFormat',
      type: 'string',
      default: 'yyyy-MM-dd HH:mm:ss ZZZZ',
      required: true,
      displayOptions: { show: { operation: ['format'], outputFormat: ['custom'] } },
      description: 'Luxon-style format used to render the output',
    },
    {
      displayName: 'Amount',
      name: 'amount',
      type: 'number',
      default: 1,
      displayOptions: { show: { operation: ['add', 'subtract'] } },
      description: 'Amount of the selected unit to add or subtract',
    },
    {
      displayName: 'Unit',
      name: 'unit',
      type: 'options',
      default: 'days',
      displayOptions: { show: { operation: ['add', 'subtract'] } },
      options: [
        { name: 'Years', value: 'years' },
        { name: 'Months', value: 'months' },
        { name: 'Weeks', value: 'weeks' },
        { name: 'Days', value: 'days' },
        { name: 'Hours', value: 'hours' },
        { name: 'Minutes', value: 'minutes' },
        { name: 'Seconds', value: 'seconds' },
        { name: 'Milliseconds', value: 'milliseconds' },
      ],
    },
    timezone,
    outputField,
  ],
};
