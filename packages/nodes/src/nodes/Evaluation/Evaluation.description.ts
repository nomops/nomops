import type { INodeTypeDescription } from '@nomops/workflow';

/**
 * 评测记分节点（backlog #31）：在工作流里记录本次运行的指标或实际输出。
 * - setMetrics：一组 名称→数值（值支持 `={{ }}` 表达式，如 `={{ $json.score }}`），
 *   写入 item.json 的保留键 `_nmMetrics`，EvaluationService 跑完后提取并按行聚合。
 * - setOutputs：一组 名称→任意值，写入 `_nmOutputs`（用例详情展示实际输出）。
 * 引擎零耦合：不需要引擎/服务对本节点做任何特判（守铁律五）。
 */
export const evaluationDescription: INodeTypeDescription = {
  displayName: 'Evaluation',
  name: 'evaluation',
  group: ['transform'],
  categories: ['ai', 'dataTransformation'],
  subcategories: ['Evaluation'],
  version: 1,
  description: 'Record metrics or outputs for the current evaluation run',
  defaults: { name: 'Evaluation' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      default: 'setMetrics',
      options: [
        { name: 'Set Metrics', value: 'setMetrics', description: 'Record numeric scores for this run' },
        { name: 'Set Outputs', value: 'setOutputs', description: 'Record the actual outputs for this run' },
      ],
    },
    {
      displayName: 'Metrics',
      name: 'metrics',
      type: 'assignmentCollection',
      default: {},
      description: 'Metric name → numeric value (values may be expressions)',
      displayOptions: { show: { operation: ['setMetrics'] } },
    },
    {
      displayName: 'Outputs',
      name: 'outputs',
      type: 'assignmentCollection',
      default: {},
      description: 'Output name → value (values may be expressions)',
      displayOptions: { show: { operation: ['setOutputs'] } },
    },
  ],
};
