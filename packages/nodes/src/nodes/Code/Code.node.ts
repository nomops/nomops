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
    const $input = { all: () => items, first: () => items[0], item: items[0] };
    const console = Object.freeze({ log() {}, info() {}, warn() {}, error() {} });
    const sandbox = vm.createContext({ items, item: items[0], $json: items[0]?.json, $input, console, JSON, Math, Date, Object, Array, String, Number, Boolean });
    const result = vm.runInContext('(function(){ "use strict";\\n' + code + '\\n})()', sandbox, { timeout: 4000 });
    process.send({ ok: true, result });
  } catch (error) {
    process.send({ ok: false, error: String(error && error.message || error) });
  }
});
`;

/**
 * Python runner: isolated interpreter (-I -S), empty environment, CPU/memory/file limits,
 * restricted builtins and AST rejection for imports, dunder access and dynamic-code/file primitives.
 */
const PYTHON_RUNNER_SOURCE = String.raw`
import ast, json, resource, sys

try:
  resource.setrlimit(resource.RLIMIT_CPU, (4, 4))
  resource.setrlimit(resource.RLIMIT_AS, (128 * 1024 * 1024, 128 * 1024 * 1024))
  resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
  resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
except Exception:
  pass

try:
  payload = json.loads(sys.stdin.read())
  user_code = str(payload.get("code", ""))
  tree = ast.parse(user_code, "<nomops-code>", "exec")
  blocked_names = {"open", "eval", "exec", "compile", "globals", "locals", "vars", "getattr", "setattr", "delattr", "input", "help", "breakpoint", "__import__"}
  for node in ast.walk(tree):
    if isinstance(node, (ast.Import, ast.ImportFrom)):
      raise ValueError("Python imports are not available in the Code node")
    if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
      raise ValueError("Private and dunder attributes are not available in the Code node")
    if isinstance(node, ast.Name) and node.id in blocked_names:
      raise ValueError("Blocked Python primitive: " + node.id)

  def safe_print(*args, **kwargs):
    print(*args, file=sys.stderr, **{key: value for key, value in kwargs.items() if key in ("sep", "end", "flush")})

  safe_builtins = {
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict, "enumerate": enumerate,
    "float": float, "int": int, "len": len, "list": list, "max": max, "min": min,
    "print": safe_print, "range": range, "reversed": reversed, "round": round, "set": set,
    "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip,
    "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
  }
  items = payload.get("items", [])
  scope = {"__builtins__": safe_builtins, "_items": items, "_item": items[0] if items else None}
  indented = "\n".join("  " + line for line in user_code.splitlines()) or "  pass"
  exec(compile("def __nomops_user__():\n" + indented, "<nomops-code>", "exec"), scope, scope)
  result = scope["__nomops_user__"]()
  sys.stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
except BaseException as error:
  sys.stdout.write(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
`;

interface RunnerReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** 在独立进程里跑用户代码。 */
export function runJavaScriptInChildProcess(code: string, items: INodeExecutionData[]): Promise<unknown> {
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

function runPythonInChildProcess(code: string, items: INodeExecutionData[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env['NOMOPS_PYTHON_BIN'] ?? 'python3', ['-I', '-S', '-c', PYTHON_RUNNER_SOURCE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PYTHONIOENCODING: 'utf-8' },
    });
    let settled = false;
    let stdout = '';
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn();
    };
    const killTimer = setTimeout(
      () => finish(() => reject(new OperationalError(`Python Code node timed out (>${TIMEOUT_MS}ms); the subprocess was terminated`))),
      TIMEOUT_MS,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 10_000_000) finish(() => reject(new OperationalError('Python Code node produced too much output')));
    });
    child.on('error', (error) => finish(() => reject(new OperationalError(`Python subprocess failed to start: ${error.message}`))));
    child.on('close', (codeNum) => finish(() => {
      if (codeNum !== 0) {
        reject(new OperationalError(`Python subprocess exited unexpectedly (exit ${codeNum})`));
        return;
      }
      try {
        const reply = JSON.parse(stdout) as RunnerReply;
        if (reply.ok) resolve(reply.result);
        else reject(new OperationalError(`Code node execution failed: ${reply.error}`));
      } catch {
        reject(new OperationalError('Python Code node returned an invalid runner response'));
      }
    }));
    child.stdin.end(JSON.stringify({ code, items }));
  });
}

/**
 * Code 节点 —— 独立进程沙箱（Phase 5，替换 Phase 2 的进程内 vm 临时方案）。
 * 用户代码在单独 node 进程执行：空 env、无 require、超时 SIGKILL、IPC 传数据（天然深拷贝）。
 */
export class Code implements INodeType {
  description = codeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const mode = String(this.getNodeParameter('mode', 0, 'runOnceForAllItems') ?? 'runOnceForAllItems');
    const language = String(this.getNodeParameter('language', 0, 'javaScript') ?? 'javaScript');
    const legacyCode = this.getNodeParameter('code', 0, undefined);
    const code = String(language === 'python'
      ? this.getNodeParameter('pythonCode', 0, legacyCode ?? 'return _items')
      : this.getNodeParameter('jsCode', 0, legacyCode ?? 'return $input.all();'));
    if (!['javaScript', 'python'].includes(language)) throw new OperationalError(`Unsupported Code language: ${language}`);
    const runCode = language === 'python' ? runPythonInChildProcess : runJavaScriptInChildProcess;
    const input = this.getInputData();
    if (mode === 'runOnceForEachItem') {
      const output: INodeExecutionData[] = [];
      for (const [index, source] of input.entries()) {
        const result = await runCode(code, [source]);
        const values = Array.isArray(result) ? result : [result];
        for (const value of values) {
          if (value === undefined) continue;
          if (value !== null && typeof value === 'object' && 'json' in value) {
            output.push({ json: (value as INodeExecutionData).json, pairedItem: { item: index } });
          } else if (value !== null && typeof value === 'object') {
            output.push({ json: value as Record<string, unknown>, pairedItem: { item: index } });
          } else {
            throw new OperationalError(`Code item ${index} must return an object`);
          }
        }
      }
      return [output];
    }
    const result = await runCode(code, input);

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
