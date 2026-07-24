import type { Repositories } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 实例助手工具集 + 风险分级（backlog #45 M3）。
 * 安全(只读)工具直接执行;其余(含未知)一律判 dangerous → 走 HITL 待确认（fail-safe：
 * 拿不准就要人确认,契合平台「外发/不可逆先确认」安全边界）。执行器可注入（测试用假实现）。
 */

/** 工具执行上下文（归属：projectId 决定能碰哪些资源）。 */
export interface ToolContext {
  threadId: string;
  userId: string;
  projectId: string;
}

/** 工具执行器：给定工具名 + 参数 + 上下文 → 结果。 */
export type ToolExecutor = (tool: string, args: JsonObject, ctx: ToolContext) => Promise<JsonObject>;

/** 只读安全工具白名单（直接执行,不走确认）。 */
export const SAFE_TOOLS = new Set(['echo', 'list_workflows']);

export interface RiskVerdict {
  risk: 'safe' | 'dangerous';
  reason: string;
}

/** 风险分级：白名单内=safe;其余(含未知工具)=dangerous（fail-safe）。 */
export function classifyRisk(tool: string): RiskVerdict {
  if (SAFE_TOOLS.has(tool)) return { risk: 'safe', reason: 'Read-only tool' };
  const known: Record<string, string> = {
    archive_workflow: 'Archives a workflow (modifies instance state)',
    delete_workflow: 'Permanently deletes a workflow',
    deactivate_workflow: 'Stops a running workflow',
    send_message: 'Sends an outbound message',
  };
  return { risk: 'dangerous', reason: known[tool] ?? 'Unknown tool — requires approval by default' };
}

/**
 * 内置工具执行器（生产缺省）。危险工具都经归属校验（铁律 2）。
 * 可插拔：bootstrap 传入,M5 会扩到 MCP 工具。
 */
export function buildDefaultToolExecutor(repos: Repositories): ToolExecutor {
  return async (tool, args, ctx) => {
    switch (tool) {
      case 'echo':
        return { echoed: args };
      case 'list_workflows': {
        const wfs = await repos.workflows.findAllByProject(ctx.projectId);
        return { workflows: wfs.map((w) => ({ id: w.id, name: w.name, active: w.active })) };
      }
      case 'archive_workflow': {
        const id = String(args['id'] ?? '');
        const wf = id ? await repos.workflows.findById(id, ctx.projectId) : null;
        if (!wf) throw new OperationalError('Workflow not found in this project', { status: 404 });
        await repos.workflows.setFlags(id, { archived: true });
        return { archived: id, name: wf.name };
      }
      default:
        throw new OperationalError(`No executor for tool: ${tool}`, { status: 400 });
    }
  };
}
