import { Router, type Request, type Response } from 'express';
import type { AppServices } from '../app-services.js';

/**
 * Prometheus 指标端点（GET /metrics，文本格式 0.0.4，零依赖手搓）。
 * 只暴露实例级聚合计数——绝无项目数据、绝无凭证（铁律 3）。
 * 默认开启；NOMOPS_METRICS=false 关闭（返回 404）。
 */
export function createMetricsRouter(services: AppServices): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/metrics', (req: Request, res: Response) => {
    void (async () => {
      if (process.env['NOMOPS_METRICS'] === 'false') {
        res.status(404).end();
        return;
      }
      const lines: string[] = [];
      const gauge = (name: string, help: string, value: number, labels = '') => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name}${labels} ${value}`);
      };

      // 执行计数按状态分桶（counter 语义，但从 DB 即时聚合，用 gauge 声明避免误导）
      const statuses = await services.repos.executions.countByStatus();
      lines.push('# HELP nomops_executions_total Executions by status');
      lines.push('# TYPE nomops_executions_total gauge');
      for (const [status, count] of Object.entries(statuses)) {
        lines.push(`nomops_executions_total{status="${status}"} ${count}`);
      }

      gauge('nomops_workflows_total', 'Workflows on this instance', await services.repos.workflows.countAll());
      gauge('nomops_workflows_active', 'Active (trigger-registered) workflows', await services.repos.workflows.countActive());
      gauge('nomops_users_total', 'Users on this instance', await services.repos.users.count());
      gauge('nomops_process_uptime_seconds', 'Server process uptime', Math.round((Date.now() - startedAt) / 1000));
      gauge('nomops_process_memory_rss_bytes', 'Resident memory', process.memoryUsage().rss);

      res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(`${lines.join('\n')}\n`);
    })().catch(() => res.status(500).end());
  });

  return router;
}
