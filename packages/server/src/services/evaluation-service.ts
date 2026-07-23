import type { Repositories, TestRun, TestCaseRun } from '@nomops/db';
import type { INode, IRun, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { ExecutionService } from './execution-service.js';
import type { WorkflowService } from './workflow-service.js';

/** 记分节点写入的保留键（与 @nomops/nodes Evaluation 节点约定一致）。 */
const METRICS_KEY = '_nmMetrics';
const OUTPUTS_KEY = '_nmOutputs';
/** 若数据集定义了名为 passed 的指标，用其 >=1 判定用例通过。 */
const PASS_METRIC = 'passed';

const EVAL_TRIGGER_TYPE = 'nomops.evaluationTrigger';

export interface ITestRunView {
  run: TestRun;
  cases?: TestCaseRun[];
}

/**
 * 评测子系统（backlog #31）：用数据集（data table）逐行跑工作流，收集记分节点写入
 * 的指标，落库为 test_run + 每行 test_case_run，并按指标名求均值聚合。
 * 引擎零耦合：指标从执行 runData 的保留键提取，不需要引擎对评测节点做任何特判。
 */
export class EvaluationService {
  constructor(
    private readonly repos: Repositories,
    private readonly workflows: WorkflowService,
    private readonly executions: ExecutionService,
  ) {}

  /**
   * 发起一次测试运行：同步逐行跑完并返回已完成的 test_run（含聚合指标）。
   * 数据集通常是小规模测试用例，同步执行；大数据集会阻塞该请求（已知取舍）。
   */
  async createTestRun(
    workflowId: string,
    projectId: string,
    opts: { dataTableId?: string; limit?: number } = {},
  ): Promise<TestRun> {
    const row = await this.workflows.getById(workflowId, projectId); // 跨项目 404
    const trigger = (row.nodes as INode[]).find((n) => n.type === EVAL_TRIGGER_TYPE && !n.disabled);
    if (!trigger) {
      throw new OperationalError('This workflow has no Evaluation Trigger node', { status: 400 });
    }

    const params = (trigger.parameters ?? {}) as { dataTableId?: string; limit?: number };
    const dataTableId = opts.dataTableId ?? params.dataTableId ?? '';
    if (!dataTableId) {
      throw new OperationalError('No dataset bound to the Evaluation Trigger', { status: 400 });
    }
    const table = await this.repos.dataTables.findById(dataTableId, projectId);
    if (!table) throw new OperationalError('Dataset not found', { status: 404, dataTableId });

    const limit = opts.limit ?? params.limit ?? 0;
    let rows = await this.repos.dataTables.findRows(dataTableId);
    if (limit > 0) rows = rows.slice(0, limit);

    const testRun = await this.repos.testRuns.createRun({
      workflowId: row.id,
      dataTableId,
      triggerNode: trigger.name,
      totalCases: rows.length,
    });

    const perCaseMetrics: Array<Record<string, number>> = [];
    let passCount = 0;
    let anyPassMetric = false;
    let ran = 0;

    for (const [rowIndex, dataRow] of rows.entries()) {
      const seed = [{ json: (dataRow.data ?? {}) as JsonObject }];
      try {
        const { executionId, run } = await this.executions.runEvaluationCase(
          row,
          projectId,
          trigger.name,
          seed,
        );
        const { metrics } = extractEvalData(run);
        perCaseMetrics.push(metrics);
        if (PASS_METRIC in metrics) {
          anyPassMetric = true;
          if (metrics[PASS_METRIC]! >= 1) passCount++;
        }
        await this.repos.testRuns.addCaseRun({
          testRunId: testRun.id,
          executionId,
          rowIndex,
          input: (dataRow.data ?? {}) as JsonObject,
          metrics,
          status: run.status === 'success' ? 'success' : 'error',
          error: run.data.resultData.error?.message ?? null,
        });
      } catch (e) {
        await this.repos.testRuns.addCaseRun({
          testRunId: testRun.id,
          executionId: null,
          rowIndex,
          input: (dataRow.data ?? {}) as JsonObject,
          metrics: {},
          status: 'error',
          error: (e as Error).message,
        });
      }
      ran++;
      await this.repos.testRuns.updateRun(testRun.id, { ranCases: ran });
    }

    const aggregated = aggregateMetrics(perCaseMetrics);
    await this.repos.testRuns.updateRun(testRun.id, {
      status: 'completed',
      ranCases: ran,
      passedCases: anyPassMetric ? passCount : null,
      metrics: aggregated,
      completedAt: new Date(),
    });

    return (await this.repos.testRuns.findRunById(testRun.id, projectId))!;
  }

  async listTestRuns(workflowId: string, projectId: string): Promise<TestRun[]> {
    return this.repos.testRuns.findRunsByWorkflow(workflowId, projectId);
  }

  async getTestRun(id: string, projectId: string): Promise<ITestRunView> {
    const run = await this.repos.testRuns.findRunById(id, projectId);
    if (!run) throw new OperationalError('Test run not found', { status: 404, id });
    const cases = await this.repos.testRuns.findCaseRuns(id);
    return { run, cases };
  }

  async deleteTestRun(id: string, projectId: string): Promise<void> {
    const run = await this.repos.testRuns.findRunById(id, projectId);
    if (!run) throw new OperationalError('Test run not found', { status: 404, id });
    await this.repos.testRuns.deleteRun(id);
  }
}

/** 从执行 runData 里扫出所有 item 的 _nmMetrics/_nmOutputs（跨节点合并，后写覆盖先写）。 */
function extractEvalData(run: IRun): { metrics: Record<string, number>; outputs: JsonObject } {
  const metrics: Record<string, number> = {};
  const outputs: JsonObject = {};
  const runData = run.data.resultData.runData;
  for (const tasks of Object.values(runData)) {
    for (const task of tasks) {
      for (const port of Object.values(task.data ?? {})) {
        for (const items of port) {
          for (const item of items ?? []) {
            const j = item.json as Record<string, unknown>;
            const m = j[METRICS_KEY] as Record<string, number> | undefined;
            if (m) for (const [k, v] of Object.entries(m)) if (Number.isFinite(v)) metrics[k] = v;
            const o = j[OUTPUTS_KEY] as JsonObject | undefined;
            if (o) Object.assign(outputs, o);
          }
        }
      }
    }
  }
  return { metrics, outputs };
}

/** 各指标名跨用例求均值（只统计定义了该指标的用例）。 */
function aggregateMetrics(perCase: Array<Record<string, number>>): Record<string, number> {
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const m of perCase) {
    for (const [k, v] of Object.entries(m)) {
      sum[k] = (sum[k] ?? 0) + v;
      count[k] = (count[k] ?? 0) + 1;
    }
  }
  const avg: Record<string, number> = {};
  for (const k of Object.keys(sum)) avg[k] = sum[k]! / count[k]!;
  return avg;
}
