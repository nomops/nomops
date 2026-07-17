/**
 * @nomops/workflow — 引擎抽象层（Layer 1）。
 *
 * 铁律：零业务依赖。本包不 import DB / HTTP / 具体节点，只定义
 * 「什么是节点、连接、数据流、如何求值表达式」的纯类型与工具。
 */
export const WORKFLOW_PACKAGE = '@nomops/workflow';

export * from './interfaces.js';
export * from './execution-interfaces.js';
export { ExecutionPause, OperationalError, UnexpectedError } from './errors.js';
export type { IErrorContext } from './errors.js';
export { Workflow } from './workflow.js';
export type { IWorkflowInit, IIncomingConnection } from './workflow.js';
export { ExpressionError, evaluateInSandbox } from './expression/sandbox.js';
export { isExpression, resolveParameterValue } from './expression/evaluator.js';
export type { IExpressionContext } from './expression/evaluator.js';
