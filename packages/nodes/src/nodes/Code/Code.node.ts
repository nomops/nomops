import { spawn } from 'node:child_process';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { codeDescription } from './Code.description.js';

const TIMEOUT_MS = 5_000;

/**
 * 子进程 runner（内联脚本，经 `node -e` 启动，IPC 通信）。
 * 在子进程内仍用 vm 收紧全局，但真正的隔离边界是进程：
 * 崩溃/死循环只影响子进程，超时由父进程 SIGKILL 强杀。
 * 子进程以空 env 启动，用户代码作用域内无 require/process。
 */
const RUNNER_SOURCE = `
const vm = require('node:vm');
process.on('message', ({ code, items }) => {
  try {
    const sandbox = vm.createContext({ items, JSON, Math, Date, Object, Array, String, Number, Boolean });
    const result = vm.runInContext('(function(){ "use strict";\\n' + code + '\\n})()', sandbox, { timeout: 4000 });
    process.send({ ok: true, result });
  } catch (error) {
    process.send({ ok: false, error: String(error && error.message || error) });
  }
});
`;

interface RunnerReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** 在独立进程里跑用户代码。 */
function runInChildProcess(code: string, items: INodeExecutionData[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', RUNNER_SOURCE], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {}, // 不泄漏父进程环境变量（凭证等可能在 env 里）
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      child.kill('SIGKILL');
      fn();
    };

    const killTimer = setTimeout(
      () => finish(() => reject(new OperationalError(`Code node timed out (>${TIMEOUT_MS}ms); the subprocess was terminated`))),
      TIMEOUT_MS,
    );

    child.on('message', (reply: RunnerReply) => {
      finish(() => {
        if (reply.ok) resolve(reply.result);
        else reject(new OperationalError(`Code node execution failed: ${reply.error}`));
      });
    });
    child.on('error', (error) => finish(() => reject(new OperationalError(`Code subprocess failed to start: ${error.message}`))));
    child.on('exit', (codeNum) => {
      finish(() => reject(new OperationalError(`Code subprocess exited unexpectedly (exit ${codeNum})`)));
    });

    child.send({ code, items });
  });
}

/**
 * Code 节点 —— 独立进程沙箱（Phase 5，替换 Phase 2 的进程内 vm 临时方案）。
 * 用户代码在单独 node 进程执行：空 env、无 require、超时 SIGKILL、IPC 传数据（天然深拷贝）。
 */
export class Code implements INodeType {
  description = codeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const code = (this.getNodeParameter('code', 0, 'return items;') ?? 'return items;') as string;
    const result = await runInChildProcess(code, this.getInputData());

    if (!Array.isArray(result)) {
      throw new OperationalError('The Code node must return an items array (e.g. return items;)');
    }
    const output: INodeExecutionData[] = result.map((item, i) => {
      if (item !== null && typeof item === 'object' && 'json' in item) {
        return { json: (item as INodeExecutionData).json, pairedItem: { item: i } };
      }
      return { json: item as Record<string, unknown>, pairedItem: { item: i } };
    });
    return [output];
  }
}
