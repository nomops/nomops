import type { IExecuteContext, IInlineWorkflowDefinition, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { executeWorkflowDescription } from './ExecuteWorkflow.description.js';

/**
 * 子工作流节点：经 helpers.executeSubWorkflow（服务层注入）嵌套执行。
 * 归属校验与递归深度限制在服务层实现——节点保持纯粹（铁律 1/6）。
 */
export class ExecuteWorkflow implements INodeType {
  description = executeWorkflowDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const source = String(this.getNodeParameter('source', 0, 'database'));
    if (!this.helpers.executeSubWorkflow) {
      throw new OperationalError('The current execution environment does not support sub-workflows (no service layer injected)');
    }
    const items = this.getInputData();
    const mode = String(this.getNodeParameter('mode', 0, 'once'));
    const targetAt = (itemIndex: number): string | IInlineWorkflowDefinition => {
      if (source === 'parameter') {
        const raw = this.getNodeParameter('workflowJson', itemIndex, '{}');
        let parsed: unknown = raw;
        if (typeof raw === 'string') {
          try { parsed = JSON.parse(raw); }
          catch { throw new OperationalError('Execute Workflow: Workflow JSON is not valid JSON', { parameter: 'workflowJson', itemIndex }); }
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new OperationalError('Execute Workflow: Workflow JSON must be an object', { parameter: 'workflowJson', itemIndex });
        }
        return parsed as IInlineWorkflowDefinition;
      }
      const locator = this.getNodeParameter('workflowId', itemIndex, '') as string | { mode?: string; value?: string };
      let workflowId = typeof locator === 'string' ? locator : String(locator?.value ?? '');
      if (typeof locator === 'object' && locator?.mode === 'url') {
        workflowId = workflowId.match(/\/workflow\/([^/?#]+)/)?.[1] ?? '';
      }
      if (!workflowId) throw new OperationalError('The Execute Workflow node is missing the workflowId parameter');
      return workflowId;
    };

    if (mode === 'each') {
      const output: INodeExecutionData[] = [];
      for (const [index, item] of items.entries()) {
        const result = await this.helpers.executeSubWorkflow(targetAt(index), [item]);
        output.push(...result.map((entry) => ({ ...entry, pairedItem: { item: index } })));
      }
      return [output];
    }
    const output = await this.helpers.executeSubWorkflow(targetAt(0), items);
    return [output.map((entry, index) => ({
      ...entry,
      pairedItem: entry.pairedItem ?? { item: Math.min(index, Math.max(0, items.length - 1)) },
    }))];
  }
}
