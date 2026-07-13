import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { executeWorkflowDescription } from './ExecuteWorkflow.description.js';

/**
 * 子工作流节点：经 helpers.executeSubWorkflow（服务层注入）嵌套执行。
 * 归属校验与递归深度限制在服务层实现——节点保持纯粹（铁律 1/6）。
 */
export class ExecuteWorkflow implements INodeType {
  description = executeWorkflowDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const workflowId = (this.getNodeParameter('workflowId', 0) ?? '') as string;
    if (!workflowId) {
      throw new OperationalError('The Execute Workflow node is missing the workflowId parameter');
    }
    if (!this.helpers.executeSubWorkflow) {
      throw new OperationalError('The current execution environment does not support sub-workflows (no service layer injected)');
    }
    const output = await this.helpers.executeSubWorkflow(workflowId, this.getInputData());
    return [output.map((item, i) => ({ json: item.json, pairedItem: { item: i } }))];
  }
}
