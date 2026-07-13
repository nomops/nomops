/**
 * @nomops/nodes — 具体节点（Layer 3）。
 *
 * 只写声明式节点（description + execute），依赖 @nomops/workflow 的节点接口。
 * 对外暴露 `builtinNodeManifest`（懒加载清单）与各节点 description。
 * 节点类本身只经清单里的 `load()` 懒加载，不在此静态导出，以保持启动懒加载特性。
 */
export const NODES_PACKAGE = '@nomops/nodes';

export { builtinNodeManifest } from './manifest.js';
export { setDescription } from './nodes/Set/Set.description.js';
export { noOpDescription } from './nodes/NoOp/NoOp.description.js';
export { manualTriggerDescription } from './nodes/ManualTrigger/ManualTrigger.description.js';
