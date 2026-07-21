import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { errorTriggerDescription } from './ErrorTrigger.description.js';

/**
 * 错误处理流起点：真实触发时由服务层播种失败上下文（workflow/execution/error），
 * 本 execute 只在手动调试时跑——吐一份同构的示例数据方便下游开发。
 */
export class ErrorTrigger implements INodeType {
  description = errorTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [
      [
        {
          json: {
            workflow: { id: 'sample-workflow-id', name: 'Sample failing workflow' },
            execution: { id: 'sample-execution-id', mode: 'manual' },
            error: { message: 'Sample error message (manual test run)', node: 'Sample Node' },
          },
        },
      ],
    ];
  }
}
