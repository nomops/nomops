/**
 * 核心契约类型（Layer 1，纯类型，零运行时依赖）。
 * 对应 docs/02-DATA-MODEL.md 第二、三、四节。
 *
 * 本文件只定义「什么是节点/连接/数据流/节点类型」的类型契约。
 * 引擎状态机（Workflow 类、RunExecutionData 逻辑、执行上下文实现）属于 Phase 2。
 */

/* ────────────────  数据流基本单位（02-DATA-MODEL 第四节）  ──────────────── */

/** 动态 JSON 数据对象。数据流天然动态，这里是唯一允许的宽松类型。 */
export type JsonObject = Record<string, unknown>;

export interface IBinaryData {
  data: string; // base64
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
}

/** 溯源：本 item 来自哪个输入 item / 哪个输入端口。 */
export interface IPairedItemData {
  item: number;
  input?: number;
}

/** 节点输入/输出的基本单位。 */
export interface INodeExecutionData {
  json: JsonObject;
  binary?: Record<string, IBinaryData>;
  pairedItem?: IPairedItemData | IPairedItemData[] | number;
  error?: Error;
}

/* ────────────────  Workflow JSON（02-DATA-MODEL 第二节）  ──────────────── */

export interface INode {
  id: string; // 画布内唯一
  name: string; // 显示名，连接用它引用（唯一）
  type: string; // node type 全名，如 'nomops.httpRequest'
  typeVersion: number;
  position: [number, number];
  parameters: JsonObject;
  credentials?: Record<string, { id: string; name: string }>;
  disabled?: boolean;
  /**
   * 节点报错时的行为：true = 把错误 item 从「错误输出端口」放出去继续
   * （错误端口 = 声明输出之后追加的一个端口，索引 = description.outputs.length）；
   * false/缺省 = 终止整个执行。
   */
  continueOnError?: boolean;
}

/** 一条连接的目标端点。 */
export interface IConnectionEndpoint {
  node: string; // 目标节点 name
  type: string; // 目标输入类型，通常 'main'
  index: number; // 目标输入端口索引
}

/**
 * 某个源节点的所有出向连接。
 * key = 连接类型（主数据流为 'main'）；
 * 外层数组索引 = 源节点的输出端口索引（如 IF 输出0=true、输出1=false）。
 */
export interface INodeConnections {
  [connectionType: string]: Array<IConnectionEndpoint[] | null>;
}

/** 整张图的连接表，key = 源节点 name。 */
export interface IConnections {
  [sourceNodeName: string]: INodeConnections;
}

export interface IWorkflowSettings {
  timezone?: string;
  executionTimeout?: number;
  errorWorkflow?: string;
  [key: string]: unknown;
}

/* ────────────────  节点定义 Schema（02-DATA-MODEL 第三节）  ──────────────── */

export type NodePropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'options'
  | 'collection'
  | 'json'
  | 'dateTime'
  | 'color'
  | 'notice';

export interface INodePropertyOption {
  name: string;
  value: string | number | boolean;
  description?: string;
}

/** 条件显示：仅当其他参数满足条件时才显示本参数。 */
export interface IDisplayOptions {
  show?: Record<string, Array<string | number | boolean>>;
  hide?: Record<string, Array<string | number | boolean>>;
}

/** 参数定义 —— 前端据此渲染表单控件。 */
export interface INodeProperties {
  displayName: string;
  name: string;
  type: NodePropertyType;
  default: unknown;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: INodePropertyOption[];
  displayOptions?: IDisplayOptions;
  noDataExpression?: boolean;
}

export interface INodeCredentialDescription {
  name: string;
  required?: boolean;
}

/**
 * Webhook 声明（docs/02 `webhooks?: IWebhookDescription[]`）。
 * 值可以是字面量，也可以声明式引用节点参数（{ parameter: 'path' } → node.parameters.path），
 * 由触发器管理器解析——不写表达式、不搞节点特判（铁律 6）。
 */
export interface IWebhookDescription {
  httpMethod: string | { parameter: string };
  path: string | { parameter: string };
}

/** 声明式节点描述：同时驱动前端表单、参数校验与执行。 */
export interface INodeTypeDescription {
  displayName: string;
  name: string; // 短名 'httpRequest'（全名 'nomops.httpRequest'）
  group: string[]; // 'trigger' | 'transform' | 'output' ...
  version: number | number[];
  description: string;
  defaults: { name: string };
  inputs: string[]; // 输入端口
  outputs: string[]; // 输出端口（IF 为 ['main','main']）
  credentials?: INodeCredentialDescription[];
  properties: INodeProperties[];
  polling?: boolean;
  /** webhook 型触发器声明；有此字段 = 激活时注册 webhook 路由。 */
  webhooks?: IWebhookDescription[];
}

/* ────────────────  节点执行上下文（引擎在 Phase 2 实现，此处定契约）  ──────────────── */

export interface IHttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: unknown;
  qs?: Record<string, unknown>;
}

export interface INodeExecutionHelpers {
  httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  /**
   * 执行子工作流（ExecuteWorkflow 节点用）：入参 items 作为子流种子，
   * 返回子流末节点输出。由服务层注入（归属校验 + 递归深度限制），
   * 纯引擎环境（无 DB）下不可用。
   */
  executeSubWorkflow?(workflowId: string, items: INodeExecutionData[]): Promise<INodeExecutionData[]>;
}

/** execute 函数里的 `this`。getNodeParameter 会自动求值 `{{ }}` 表达式（Phase 2）。 */
export interface IExecuteContext {
  getInputData(inputIndex?: number): INodeExecutionData[];
  getNodeParameter(name: string, itemIndex: number): unknown;
  getNodeParameter(name: string, itemIndex: number, fallback: unknown): unknown;
  getCredentials(type: string): Promise<JsonObject>;
  getWorkflowStaticData(type: string): JsonObject;
  helpers: INodeExecutionHelpers;
}

export interface ITriggerResponse {
  closeFunction?: () => Promise<void>;
}

export interface ITriggerContext {
  emit(data: INodeExecutionData[][]): void;
  getNodeParameter(name: string): unknown;
  getWorkflowStaticData(type: string): JsonObject;
}

/** 一个 node type = 声明式 description + execute（动作/逻辑）或 trigger（触发器）。 */
export interface INodeType {
  description: INodeTypeDescription;
  execute?(this: IExecuteContext): Promise<INodeExecutionData[][]>;
  trigger?(this: ITriggerContext): Promise<ITriggerResponse>;
}

export type INodeTypeConstructor = new () => INodeType;

/**
 * 节点加载器的注册单元。
 * description 轻量、启动即常驻（供前端节点面板）；
 * load() 懒加载重量级类（含 execute 代码），首次用到才触发。
 */
export interface ILoadableNodeType {
  type: string; // 全名，如 'nomops.set'
  description: INodeTypeDescription;
  load: () => Promise<INodeTypeConstructor>;
}
