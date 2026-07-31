import type { INodeTypeDescription } from '@nomops/workflow';

/**
 * 评测触发起点（backlog #31）：把绑定的数据集（data table）逐行喂给工作流。
 * 真正的逐行迭代由 EvaluationService 驱动（每行作为 seed 注入本节点输出）；
 * 手动点 Execute 时输出注入的那一行，或一个空 item 供画布调试。
 */
export const evaluationTriggerDescription: INodeTypeDescription = {
  displayName: 'Evaluation Trigger',
  name: 'evaluationTrigger',
  group: ['trigger'],
  categories: ['trigger', 'ai'],
  subcategories: ['Evaluation'],
  version: 1,
  description: 'Run this workflow once per row of a dataset (data table) to evaluate it',
  defaults: { name: 'When running an evaluation' },
  inputs: [],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Dataset (Data Table ID)',
      name: 'dataTableId',
      type: 'string',
      default: '',
      description: 'The data table whose rows drive the evaluation. Each row becomes one test case.',
      noDataExpression: true,
    },
    {
      displayName: 'Max Rows',
      name: 'limit',
      type: 'number',
      default: 0,
      description: 'Cap the number of rows evaluated (0 = all rows)',
      noDataExpression: true,
    },
  ],
};
