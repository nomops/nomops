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

/**
 * 二进制载荷：引用形态（id 指向 binary store，执行状态里只留轻量元数据——铁律 4 友好）
 * 或内联形态（data=base64，仅小载荷/无 store 的纯引擎场景）。二者互斥，id 优先。
 */
export interface IBinaryData {
  /** binary store 里的引用 id；有值时 data 应为空。 */
  id?: string;
  /** 内联 base64（引用形态下为空）。 */
  data?: string;
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
  fileSize?: number;
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

/**
 * 钉住数据（pin data 概念）：nodeName → 冻结的输出 items。
 * 手动运行时引擎直接采用钉住数据、跳过节点执行（开发期免打真实 API）；
 * 生产触发（webhook/cron）不应用——由 server 决定构造 Workflow 时是否携带。
 */
export type IPinData = Record<string, INodeExecutionData[]>;

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
  /** 节点级设置(对标 n8n NDV Settings tab)。onError 是 continueOnError 的多态版本;
   *  引擎当前仅消费 continueOnError,其余字段先做存储 + UI(行为深化后续)。 */
  onError?: 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput';
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  notes?: string;
  notesInFlow?: boolean;
}

/**
 * 连接类型：main = 数据流（items 逐节点传递）；ai_* = 能力流——
 * 子节点不进数据流执行，而是在宿主（如 AI Agent）执行时经 supplyData 提供能力对象。
 */
export const NodeConnectionTypes = {
  Main: 'main',
  AiLanguageModel: 'ai_languageModel',
  AiTool: 'ai_tool',
  AiMemory: 'ai_memory',
} as const;
export type NodeConnectionType = (typeof NodeConnectionTypes)[keyof typeof NodeConnectionTypes];

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
  /** 执行保存策略（默认全存）：false = 收尾后删除该类执行记录。 */
  saveFailedExecutions?: boolean;
  saveSuccessfulExecutions?: boolean;
  saveManualExecutions?: boolean;
  [key: string]: unknown;
}

/* ────────────────  节点定义 Schema（02-DATA-MODEL 第三节）  ──────────────── */

export type NodePropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'options'
  | 'multiOptions'
  | 'collection'
  | 'json'
  | 'dateTime'
  | 'color'
  | 'notice';

/** 声明式控件微调（对标 n8n typeOptions 子集）：多行文本 rows。 */
export interface INodePropertyTypeOptions {
  /** string 字段渲染为多行 textarea 的行数（>1 生效）。 */
  rows?: number;
}

/**
 * 声明式请求（routing 节点）：选中某 operation 时如何拼 HTTP 请求。
 * url/qs/body/headers 的值支持 `={{ }}` 表达式（作用域含 $json/$parameter/$vars…），
 * url 为相对路径时拼接 description.requestDefaults.baseUrl。
 */
export interface IHttpRequestDeclaration {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  qs?: Record<string, unknown>;
  body?: JsonObject;
  headers?: Record<string, string>;
}

export interface INodePropertyOption {
  name: string;
  value: string | number | boolean;
  description?: string;
  /** 声明式节点：选中该 operation 时的请求声明（引擎 routing 执行器消费）。 */
  routing?: IHttpRequestDeclaration;
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
  typeOptions?: INodePropertyTypeOptions;
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

/**
 * 凭证注入声明（声明式节点）：把凭证字段放进请求的方式。
 * template 里 {{field}} 占位符从解密后的凭证 data 取值（明文只在请求瞬间存在——铁律 3）。
 */
export interface ICredentialInjection {
  credentialName: string; // 对应 credentials[].name
  in: 'header' | 'query';
  key: string; // header 名或 query 参数名
  template: string; // 如 'Bearer {{apiKey}}' / '{{token}}'
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
  /** 声明式节点：请求默认值（相对 url 拼 baseUrl；headers 逐请求合并）。 */
  requestDefaults?: { baseUrl?: string; headers?: Record<string, string> };
  /** 声明式节点：凭证注入方式。 */
  credentialInjection?: ICredentialInjection;
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
  /** 二进制 → 字节（引用形态经 store 取回；内联形态解 base64）。 */
  binaryToBuffer(binary: IBinaryData): Promise<Uint8Array>;
  /** 字节 → 二进制引用（有 store 落 store；无 store 退化为内联 base64）。 */
  bufferToBinary(buffer: Uint8Array, meta: { mimeType: string; fileName?: string }): Promise<IBinaryData>;
}

/** execute 函数里的 `this`。getNodeParameter 会自动求值 `{{ }}` 表达式（Phase 2）。 */
export interface IExecuteContext {
  getInputData(inputIndex?: number): INodeExecutionData[];
  getNodeParameter(name: string, itemIndex: number): unknown;
  getNodeParameter(name: string, itemIndex: number, fallback: unknown): unknown;
  getCredentials(type: string): Promise<JsonObject>;
  getWorkflowStaticData(type: string): JsonObject;
  /** true = 本帧是 waiting 恢复后的续跑（Wait 类节点据此放行而非再次挂起）。 */
  isResumed(): boolean;
  /**
   * 解析挂在本节点 ai_* 输入上的子节点能力（经其 supplyData）。
   * 返回按连接顺序的能力对象数组（ai_tool 多个、ai_languageModel 通常一个）。
   */
  getInputConnectionData(connectionType: string): Promise<unknown[]>;
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

/* ────────────────  AI 能力契约（ai_* 连接类型上流动的对象；仅执行期存在，不进执行状态）  ──────────────── */

export interface IAiToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface IAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时：对应的 toolCall id。 */
  toolCallId?: string;
  /** role='assistant' 且模型请求调用工具时。 */
  toolCalls?: IAiToolCall[];
}

export interface IAiChatResponse {
  content: string;
  toolCalls?: IAiToolCall[];
}

/** ai_languageModel 子节点供给：聊天补全（可带工具声明）。 */
export interface IAiLanguageModel {
  chat(messages: IAiMessage[], options?: { tools?: IAiToolSpec[] }): Promise<IAiChatResponse>;
}

/** 工具声明（给模型看的 schema）。 */
export interface IAiToolSpec {
  name: string;
  description: string;
  /** 参数 JSON Schema（缺省 = 单一字符串入参 input）。 */
  parameters?: JsonObject;
}

/** ai_tool 子节点供给：可被 Agent 调用的工具。 */
export interface IAiTool {
  spec: IAiToolSpec;
  invoke(args: JsonObject): Promise<string>;
}

/** ai_memory 子节点供给：会话记忆。 */
export interface IAiMemory {
  load(sessionId: string): Promise<IAiMessage[]>;
  save(sessionId: string, messages: IAiMessage[]): Promise<void>;
}

/**
 * supplyData 的 `this`：子节点（模型/工具/记忆）在宿主执行时被解析，
 * 返回其能力对象。无 itemIndex 概念——子节点参数按 item 0 求值。
 */
export interface ISupplyDataContext {
  getNodeParameter(name: string): unknown;
  getNodeParameter(name: string, fallback: unknown): unknown;
  getCredentials(type: string): Promise<JsonObject>;
  getWorkflowStaticData(type: string): JsonObject;
  /** 嵌套组合：子节点自己也可挂子节点（如 RAG 工具挂 embedding 模型）。 */
  getInputConnectionData(connectionType: string): Promise<unknown[]>;
  helpers: {
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  };
}

/**
 * poll 函数的 `this`（轮询型触发器）：周期被调度器调用，
 * 返回新 items（触发执行）或 null/空（本轮无新数据，不触发）。
 * filterNewKeys 是去重原语：传候选键，返回其中首次出现的（并记住它们）。
 */
export interface IPollContext {
  getNodeParameter(name: string): unknown;
  getWorkflowStaticData(type: string): JsonObject;
  helpers: {
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
    filterNewKeys(keys: string[]): Promise<string[]>;
  };
}

/** 一个 node type = 声明式 description + execute（数据流）/ trigger（定时触发）/ poll（轮询触发）/ supplyData（能力供给）。 */
export interface INodeType {
  description: INodeTypeDescription;
  execute?(this: IExecuteContext): Promise<INodeExecutionData[][]>;
  trigger?(this: ITriggerContext): Promise<ITriggerResponse>;
  /** 轮询：返回新 items 触发执行；null/空 = 本轮无新数据。 */
  poll?(this: IPollContext): Promise<INodeExecutionData[][] | null>;
  /** 能力供给（ai_* 子节点）：宿主执行时被解析，返回模型/工具/记忆等能力对象。 */
  supplyData?(this: ISupplyDataContext): Promise<unknown>;
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
