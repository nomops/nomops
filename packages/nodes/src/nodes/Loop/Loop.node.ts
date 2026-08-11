import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { loopDescription } from './Loop.description.js';

/** 吐下一批（loop 输出）或收尾（done 输出）。 */
function nextBatch(ctx: JsonObject): INodeExecutionData[][] {
  const queue = ctx['queue'] as JsonObject[];
  const batchSize = Number(ctx['batchSize']) || 1;
  if (queue.length === 0) {
    const processed = (ctx['processed'] as JsonObject[]).map((json) => ({ json }));
    // 收尾后重置：同一执行内若再有新数据从上游进来（罕见）可重新开循环
    delete ctx['queue'];
    delete ctx['processed'];
    return [processed, []];
  }
  const batch = queue.splice(0, batchSize).map((json) => ({ json }));
  return [[], batch];
}

/**
 * 分批循环（对标基线 Split In Batches 语义）：
 * - 首帧：全部输入入队（存执行上下文,随状态序列化）,吐第一批到 loop 输出;
 * - 环回帧（loop 分支尾节点接回本节点）：收集处理结果,还有批次 → 吐下一批,
 *   队列吐尽 → 全部处理结果走 done 输出。
 * 引擎侧无特判：环依赖既有的「同输入口逐次触发」语义 + MAX_NODE_RUNS 熔断。
 * 注:execute 以 this=IExecuteContext 调用,跨运行状态一律走 getContext()。
 */
export class Loop implements INodeType {
  description = loopDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const ctx = this.getContext();
    const options = this.getNodeParameter('options', 0, {}) as JsonObject;
    if (options['reset'] === true) {
      delete ctx['queue'];
      delete ctx['processed'];
    }

    if (ctx['queue'] === undefined) {
      // 首帧：入队（只存 json,保序列化安全）
      const batchSize = Math.max(1, Math.floor(Number(this.getNodeParameter('batchSize', 0, 1)) || 1));
      ctx['batchSize'] = batchSize;
      ctx['queue'] = items.map((it) => it.json);
      ctx['processed'] = [];
      return nextBatch(ctx);
    }

    // 环回帧：收集上一批的处理结果
    (ctx['processed'] as JsonObject[]).push(...items.map((it) => it.json));
    return nextBatch(ctx);
  }
}
