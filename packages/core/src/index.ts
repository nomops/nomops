/**
 * @nomops/core — 执行引擎实现 + 节点加载（Layer 2）。
 *
 * 依赖 @nomops/workflow 的抽象，但不碰 HTTP。给它一个 workflow JSON + 起始数据，
 * 它能在无 server / 无 DB 下独立跑完 —— 这是三层解耦的验证点。
 *
 * 已落地：节点加载器（Phase 1）、WorkflowExecute 栈驱动引擎 + 执行上下文（Phase 2）、
 * 凭证加解密 Cipher/Credentials + IEncryptionKeyProvider（Phase 3）。
 */
export const CORE_PACKAGE = '@nomops/core';

export { NodeLoader, NodeTypeNotFoundError } from './nodes-loader/node-loader.js';
export type { INodeLoader, INodeTypeInfo } from './nodes-loader/node-loader.js';

export { WorkflowExecute, seedTriggerOutput, routeNodeOutput } from './execution-engine/workflow-execute.js';
export type { IExecutionHooks, IWorkflowExecuteOptions } from './execution-engine/workflow-execute.js';
export {
  buildPartialRunState,
  computeDirtyNodes,
  incomingSignatureOf,
} from './execution-engine/partial-execution.js';
export { executeRoutingNode, hasRoutingDeclarations } from './execution-engine/routing-executor.js';
export { createExecuteContext, createSupplyContext, defaultHttpRequest } from './execution-engine/node-execution-context.js';
export type { INodeTypeResolver, IWorkflowExecuteAdditionalData } from './execution-engine/node-execution-context.js';

export { FileSystemBinaryStore, InMemoryBinaryStore } from './binary-data/binary-store.js';
export type { IBinaryDataStore, IBinaryMeta } from './binary-data/binary-store.js';
export { Cipher } from './encryption/cipher.js';
export { StaticKeyProvider } from './encryption/key-provider.js';
export type { IEncryptionKeyProvider } from './encryption/key-provider.js';
export { Credentials } from './credentials.js';
