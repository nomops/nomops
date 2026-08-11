import type { INodeTypeDescription } from '@nomops/workflow';

export const codeDescription: INodeTypeDescription = {
  displayName: 'Code',
  name: 'code',
  group: ['transform'],
  categories: ['dataTransformation', 'core'],
  version: 1,
  description: 'Run custom JavaScript or Python code',
  defaults: { name: 'Code in JavaScript' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    { displayName: 'Mode', name: 'mode', type: 'options', default: 'runOnceForAllItems', options: [
      { name: 'Run Once for All Items', value: 'runOnceForAllItems' },
      { name: 'Run Once for Each Item', value: 'runOnceForEachItem' },
    ], noDataExpression: true },
    { displayName: 'Language', name: 'language', type: 'options', default: 'javaScript', options: [
      { name: 'JavaScript', value: 'javaScript' },
      { name: 'Python', value: 'python' },
    ], noDataExpression: true },
    {
      displayName: 'JavaScript', name: 'jsCode', type: 'string',
      default: "for (const item of $input.all()) {\n  item.json.myNewField = 1;\n}\n\nreturn $input.all();",
      typeOptions: { rows: 14, editor: 'code' }, noDataExpression: true,
      displayOptions: { show: { language: ['javaScript'] } },
      description: 'Type $ for a list of special variables and methods',
    },
    {
      displayName: 'Python', name: 'pythonCode', type: 'string',
      default: '# Loop over input items and add a new field called \'my_new_field\' to the JSON of each one\nfor item in _items:\n  item["json"]["my_new_field"] = 1\nreturn _items',
      typeOptions: { rows: 14, editor: 'code' }, noDataExpression: true,
      displayOptions: { show: { language: ['python'] } },
    },
    {
      displayName: 'Debug by using print() statements and viewing their output in the browser console. The Python option does not support the $ syntax and helpers, except for _items in all-items mode and _item in per-item mode.',
      name: 'pythonNotice', type: 'notice', default: '', typeOptions: { noticeStyle: 'warning' },
      displayOptions: { show: { language: ['python'] } },
    },
  ],
};
