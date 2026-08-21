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
   * @deprecated 用 `onError` 代替。保留仅为兼容历史工作流 JSON。
   * true 等价于 onError='continueErrorOutput'；二者并存时 onError 优先。
   */
  continueOnError?: boolean;
  /**
   * 节点报错时的行为（三态）：
   * - `stopWorkflow`（缺省）：终止整个执行；
   * - `continueErrorOutput`：错误 item 从「错误输出端口」放出去继续
   *   （错误端口 = 声明输出之后追加的一个端口，索引 = description.outputs.length）；
   * - `continueRegularOutput`：错误 item 从常规输出端口 0 放出去继续。
   * 归一化逻辑见 node-settings.ts 的 resolveOnError。
   */
  onError?: 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput';
  /** 节点输出为空时，补一个空 item，使下游仍被触发（否则空端口不扩散）。 */
  alwaysOutputData?: boolean;
  /** 只取第一个输入 item 执行一次（用于「按批只调一次 API」这类场景）。 */
  executeOnce?: boolean;
  /** 失败自动重试。取值域与默认值见 node-settings.ts 的 resolveRetry。 */
  retryOnFail?: boolean;
  /** 总尝试次数（含首次），钳制到 [2,5]，缺省 3。 */
  maxTries?: number;
  /** 两次尝试之间等待毫秒，钳制到 [0,5000]，缺省 1000。 */
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
  /** 整次执行的超时**秒**数；缺省/非正数 = 不限时。见 resolveExecutionTimeoutMs。 */
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
  | 'filter'
  | 'assignmentCollection'
  | 'resourceMapper'
  | 'fixedCollection'
  | 'resourceLocator'
  | 'json'
  | 'dateTime'
  | 'color'
  | 'notice';

/** 声明式控件微调（对标基线 typeOptions 子集）：多行文本 rows。 */
export interface INodePropertyTypeOptions {
  /** Numeric input bounds. */
  minValue?: number;
  maxValue?: number;
  /** Generate a UUID when a new node is created instead of reusing the static default. */
  generateUuid?: boolean;
  /** string 字段渲染为多行 textarea 的行数（>1 生效）。 */
  rows?: number;
  /** Rich editor chrome for multiline text fields. */
  editor?: 'code' | 'sql';
  /** Generated or otherwise derived text shown for inspection but not edited in place. */
  readOnly?: boolean;
  /** Metadata-driven editor action rendered next to a string parameter. */
  action?: {
    type: 'generateAiTransform';
    label: string;
    target: string;
    generatedForTarget: string;
    inputFieldMaxLength?: number;
  };
  /** Notice color treatment used by n8n-like inline alerts. */
  noticeStyle?: 'info' | 'warning' | 'neutral';
  /** 动态下拉：调用节点 methods.loadOptions 中的同名方法。 */
  loadOptionsMethod?: string;
  /** 动态下拉依赖的参数路径；任一值变化时前端重新加载。 */
  loadOptionsDependsOn?: string[];
  /** 声明式动态下拉，不写节点方法即可发请求并映射结果。 */
  loadOptions?: ILoadOptionsDeclaration;
  /** fixedCollection 是否允许同一分组添加多行。 */
  multipleValues?: boolean;
  /** fixedCollection 多行是否允许排序。 */
  sortable?: boolean;
  fixedCollection?: {
    itemTitle?: string;
    addButtonLabel?: string;
    layout?: 'horizontal' | 'vertical';
  };
  /** n8n dynamic fixedCollection: keep non-required row fields behind an Add Attributes menu. */
  hideOptionalFields?: boolean;
  addOptionalFieldButtonText?: string;
  /** filter 条件编辑器的节点级文案和附加字段。 */
  filter?: {
    itemTitle?: string;
    addButtonLabel?: string;
    maxConditions?: number;
    showRenameOutput?: boolean;
    /** Structured Filter v2 stores { combinator, conditions, options } instead of a bare row array. */
    valueShape?: 'array' | 'structured';
    /** Render the AND/OR selector inside the condition editor. */
    showCombinator?: boolean;
  };
  /** n8n resourceMapper: load a resource schema and map input fields automatically or explicitly. */
  resourceMapper?: {
    valuesLabel?: string;
    resourceMapperMethod: string;
    mode?: 'add' | 'update';
    addAllFields?: boolean;
    multiKeyMatch?: boolean;
  };
}

export interface IResourceMapperField {
  id: string;
  displayName: string;
  type?: string;
  required?: boolean;
  defaultMatch?: boolean;
  canBeUsedToMatch?: boolean;
}

export interface IResourceMapperFields {
  fields: IResourceMapperField[];
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
  /** 发出请求前的纯数据变换；按顺序执行，凭证注入最后应用，避免被覆盖。 */
  preSend?: IHttpRequestTransform[];
  /** 多页请求；cursor/offset 都由描述驱动，不把 provider 特判写进执行器。 */
  pagination?: IHttpPaginationDeclaration;
  /** 收到全部页面后的纯数据变换。 */
  postReceive?: IHttpResponseTransform[];
  /** 二进制响应写入 item.binary；缺省 auto 仍按 JSON/文本处理。 */
  response?: IHttpResponseDeclaration;
}

export interface IHttpRequestTransform {
  type: 'set' | 'remove';
  target: 'headers' | 'qs' | 'body';
  key: string;
  /** type=set 时必填；支持与 routing 其他值相同的表达式作用域。 */
  value?: unknown;
}

export interface IHttpPaginationDeclaration {
  mode: 'cursor' | 'offset';
  request: { in: 'query' | 'body' | 'header'; name: string };
  response: {
    /** 每页结果数组的点路径；省略表示整页响应。 */
    resultsPath?: string;
    /** cursor 模式下，下一游标的点路径。空值结束。 */
    nextCursorPath?: string;
    /** offset 模式可选的 has-more 标志点路径；省略时以空结果结束。 */
    hasMorePath?: string;
  };
  start?: string | number;
  increment?: number;
  /** 防 provider 坏响应造成无限翻页；缺省 100，最大 1000。 */
  maxPages?: number;
}

export type IHttpResponseTransform =
  | { type: 'extract'; path: string }
  | { type: 'map'; fields: Record<string, unknown> };

export interface IHttpResponseDeclaration {
  format: 'auto' | 'text' | 'binary';
  binaryPropertyName?: string;
  mimeType?: string;
  fileName?: string;
}

export interface INodePropertyOption {
  name: string;
  value: string | number | boolean;
  description?: string;
  /** 声明式节点：选中该 operation 时的请求声明（引擎 routing 执行器消费）。 */
  routing?: IHttpRequestDeclaration;
  /** fixedCollection 分组内的声明式子参数。 */
  values?: INodeProperties[];
}

export interface ILoadOptionsDeclaration {
  request: IHttpRequestDeclaration;
  /** 响应数组所在点路径；省略表示响应本身就是数组。 */
  resultsPath?: string;
  /** 每项显示名/值/描述的点路径。 */
  name: string;
  value: string;
  description?: string;
}

export interface IResourceLocatorMode {
  displayName: string;
  name: 'list' | 'url' | 'id' | 'name';
  placeholder?: string;
  /** list 模式调用节点 methods.resourceLocator 中的同名方法。 */
  searchListMethod?: string;
}

export interface IResourceLocatorValue {
  mode: IResourceLocatorMode['name'];
  value: string;
}

export interface IResourceLocatorResult {
  results: INodePropertyOption[];
  paginationToken?: string;
}

/** displayOptions 的条件操作符；与 n8n `_cnd` 契约保持一致。 */
export type DisplayCondition =
  | { _cnd: { eq: string | number | boolean | null } }
  | { _cnd: { not: string | number | boolean | null } }
  | { _cnd: { gte: number | string } }
  | { _cnd: { lte: number | string } }
  | { _cnd: { gt: number | string } }
  | { _cnd: { lt: number | string } }
  | { _cnd: { between: { from: number | string; to: number | string } } }
  | { _cnd: { startsWith: string } }
  | { _cnd: { endsWith: string } }
  | { _cnd: { includes: string } }
  | { _cnd: { regex: string } }
  | { _cnd: { exists: true } };

export type DisplayConditionValue = string | number | boolean | null | DisplayCondition;

/** 条件显示：show 的键全部命中；hide 任一键命中即隐藏。 */
export interface IDisplayOptions {
  show?: Record<string, DisplayConditionValue[] | undefined>;
  hide?: Record<string, DisplayConditionValue[] | undefined>;
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
  /** resourceLocator 的 list/url/id 模式。 */
  modes?: IResourceLocatorMode[];
  displayOptions?: IDisplayOptions;
  noDataExpression?: boolean;
  typeOptions?: INodePropertyTypeOptions;
}

export interface INodeCredentialDescription {
  name: string;
  required?: boolean;
  /** 按其他参数值条件显示该凭证槽（如多 provider 节点只显示所选 provider 的凭证）。 */
  displayOptions?: IDisplayOptions;
}

/** 节点创建面板的声明式一级分类；节点可同时出现在多个分类。 */
export type NodeCategory =
  | 'ai'
  | 'app'
  | 'dataTransformation'
  | 'flow'
  | 'core'
  | 'humanReview'
  | 'trigger';

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
  /** path = 替换 URL 占位符；body/basic 为 #63 新增桶。 */
  in: 'header' | 'query' | 'path' | 'body' | 'basic';
  key: string; // header 名 / query 参数名 / URL 占位符名
  template: string; // 如 'Bearer {{apiKey}}' / '{{token}}'
}

/**
 * 凭证类型级认证声明。一种凭证只声明一次，节点只引用 credentialName。
 * custom 模式由 INodeType.authenticate 在运行期接管，函数不会进入 description/API。
 */
export interface ICredentialAuthentication {
  credentialName: string;
  type?: 'generic' | 'custom';
  injections?: Array<Omit<ICredentialInjection, 'credentialName'>>;
}

/** 声明式节点描述：同时驱动前端表单、参数校验与执行。 */
export interface INodeTypeDescription {
  displayName: string;
  name: string; // 短名 'httpRequest'（全名 'nomops.httpRequest'）
  group: string[]; // 'trigger' | 'transform' | 'output' ...
  /** 节点创建面板分类；面板只读此元数据，不按节点 type/name 特判。 */
  categories?: NodeCategory[];
  /** 分类内的可选二级标签（如 Agents / Language Models）。 */
  subcategories?: string[];
  /** 搜索别名。 */
  aliases?: string[];
  /** 不在节点创建面板展示（仍可由画布等专用入口创建）。 */
  hidden?: boolean;
  version: number | number[];
  description: string;
  defaults: { name: string };
  inputs: string[]; // 输入端口
  outputs: string[]; // 输出端口（IF 为 ['main','main']）
  /** 多输出端口的画布标注（如 IF ['true','false']、Loop ['done','loop']）；缺省显序号。 */
  outputNames?: string[];
  credentials?: INodeCredentialDescription[];
  properties: INodeProperties[];
  polling?: boolean;
  /** webhook 型触发器声明；有此字段 = 激活时注册 webhook 路由。 */
  webhooks?: IWebhookDescription[];
  /** 声明式节点：请求默认值（相对 url 拼 baseUrl；headers 逐请求合并）。 */
  requestDefaults?: { baseUrl?: string; headers?: Record<string, string> };
  /** 声明式节点：凭证注入方式。 */
  credentialAuthentication?: ICredentialAuthentication;
  /** @deprecated 兼容旧社区节点；新节点用 credentialAuthentication。 */
  credentialInjection?: ICredentialInjection;
  /** loader 自动生成 *Tool 变体，原节点执行逻辑与凭证边界保持不变。 */
  usableAsTool?: boolean;
}

/* ────────────────  节点执行上下文（引擎在 Phase 2 实现，此处定契约）  ──────────────── */

export interface IHttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: unknown;
  qs?: Record<string, unknown>;
  /** 缺省 auto(JSON 优先/文本兜底)；binary 返回 Uint8Array。 */
  responseFormat?: 'auto' | 'text' | 'binary';
  /** 用户可控 URL 必须标记，core 会在连接与每次重定向时拒绝私网地址。 */
  urlTrust?: 'trusted' | 'user-controlled';
  /** 执行取消/超时时由引擎向所有节点请求传播。 */
  signal?: AbortSignal;
}

export interface INodeExecutionHelpers {
  httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  /**
   * 调用当前 Nomops 实例的版本化 API。服务端把目标固定到本实例、把 projectId
   * 固定到当前执行项目，并只接受枚举操作；节点不能提供 URL、路径或项目 ID。
   */
  nomopsApiRequest?(options: INomopsApiRequestOptions): Promise<unknown>;
  /**
   * 执行子工作流（ExecuteWorkflow 节点用）：入参 items 作为子流种子，
   * 返回子流末节点输出。由服务层注入（归属校验 + 递归深度限制），
   * 纯引擎环境（无 DB）下不可用。
   */
  executeSubWorkflow?(
    workflow: string | IInlineWorkflowDefinition,
    items: INodeExecutionData[],
  ): Promise<INodeExecutionData[]>;
  /**
   * 设置本次 webhook 触发的自定义 HTTP 响应（RespondToWebhook 节点用）。
   * 仅 webhook 路由注入（单进程模式）；手动运行/队列模式下缺省为 no-op。
   */
  setWebhookResponse?(response: JsonObject): void;
  /** 二进制 → 字节（引用形态经 store 取回；内联形态解 base64）。 */
  binaryToBuffer(binary: IBinaryData): Promise<Uint8Array>;
  /** 字节 → 二进制引用（有 store 落 store；无 store 退化为内联 base64）。 */
  bufferToBinary(buffer: Uint8Array, meta: { mimeType: string; fileName?: string }): Promise<IBinaryData>;
  /** 当前项目的数据表能力；项目归属由 server 注入的闭包固定，节点不能指定 projectId。 */
  dataTables?: IDataTableOperations;
}

export type NomopsApiOperation =
  | 'workflow.list'
  | 'workflow.get'
  | 'workflow.activate'
  | 'workflow.deactivate'
  | 'execution.list'
  | 'execution.get'
  | 'execution.retry'
  | 'execution.stop';

export interface INomopsApiRequestOptions {
  operation: NomopsApiOperation;
  apiKey: string;
  resourceId?: string;
  limit?: number;
  useOriginal?: boolean;
  signal?: AbortSignal;
}

export type DataTableColumnType = 'string' | 'number' | 'boolean' | 'date';

export interface IDataTableColumn {
  name: string;
  type: DataTableColumnType;
}

export interface IDataTableView {
  id: string;
  name: string;
  columns: IDataTableColumn[];
  rowCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDataTableRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  data: JsonObject;
}

export interface IDataTableOperations {
  list(): Promise<IDataTableView[]>;
  get(id: string): Promise<IDataTableView>;
  create(input: { name: string; columns?: IDataTableColumn[] }): Promise<IDataTableView>;
  rename(id: string, name: string): Promise<IDataTableView>;
  delete(id: string): Promise<void>;
  clearRows(id: string): Promise<number>;
  listRows(id: string): Promise<IDataTableRow[]>;
  insertRow(id: string, data: JsonObject): Promise<IDataTableRow>;
  updateRow(id: string, rowId: string, data: JsonObject): Promise<IDataTableRow>;
  deleteRow(id: string, rowId: string): Promise<void>;
}

/** Execute Workflow 的 Define Below 载荷；只在父执行内存中运行，不持久化。 */
export interface IInlineWorkflowDefinition {
  name?: string;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
}

/** execute 函数里的 `this`。getNodeParameter 会自动求值 `{{ }}` 表达式（Phase 2）。 */
export interface IExecuteContext {
  /** 当前正在执行的画布节点。 */
  getNode(): INode;
  getInputData(inputIndex?: number): INodeExecutionData[];
  getNodeParameter(name: string, itemIndex: number): unknown;
  getNodeParameter(name: string, itemIndex: number, fallback: unknown): unknown;
  getCredentials(type: string): Promise<JsonObject>;
  getWorkflowStaticData(type: string): JsonObject;
  /** 本节点在**本次执行**内的可变上下文（随执行状态序列化;Loop 等跨多次运行的节点用）。 */
  getContext(): JsonObject;
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

export interface IEventStreamMessage {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export interface IEventStreamOptions {
  url: string;
  headers?: Record<string, string>;
  /** 用户可控 URL 必须标记，core 会在连接时拒绝私网地址。 */
  urlTrust?: 'trusted' | 'user-controlled';
}

export interface ITriggerContext {
  emit(data: INodeExecutionData[][]): void;
  getNodeParameter(name: string): unknown;
  /** 当前注册发生的生命周期；仅由触发器管理器提供，节点不能自行伪造。 */
  getActivationMode(): 'init' | 'activate' | 'update';
  getWorkflow(): { id: string; name: string };
  getWorkflowStaticData(type: string): JsonObject;
  helpers: {
    openEventStream(
      options: IEventStreamOptions,
      onMessage: (message: IEventStreamMessage) => void,
    ): Promise<() => Promise<void>>;
  };
}

export interface IWebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  query: Record<string, string | string[]>;
  body: unknown;
  /** multipart/form-data 的文件字段；已转成 binary store 引用或内联二进制。 */
  files?: Record<string, IBinaryData | IBinaryData[]>;
}

export interface IWebhookResponseData {
  statusCode?: number;
  contentType?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface IWebhookResult {
  /** 有数据才启动/恢复工作流；仅返回 response 可用于 GET 页面。 */
  workflowData?: INodeExecutionData[];
  response?: IWebhookResponseData;
}

/** 节点自定义公开 webhook 行为；server 只负责通用分派，不识别节点 type/name。 */
export interface IWebhookContext {
  mode: 'trigger' | 'waiting';
  getNodeParameter(name: string): unknown;
  getNodeParameter(name: string, fallback: unknown): unknown;
  getContext(): JsonObject;
  getRequest(): IWebhookRequest;
}

/* ────────────────  AI 能力契约（ai_* 连接类型上流动的对象；仅执行期存在，不进执行状态）  ──────────────── */

/** Agent V3 在 contextData 中与引擎交换工具结果的保留键。 */
export const AI_TOOL_RESULTS_CONTEXT_KEY = '__agentToolResults';
/** Agent V3 自身可序列化状态的保留键。 */
export const AI_AGENT_STATE_CONTEXT_KEY = '__agentV3State';

export interface IAiToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

/** 多模态图片附件（backlog #32）：随 user 消息带给视觉模型。data 为 base64。 */
export interface IAiImageAttachment {
  mimeType: string; // 如 image/png、image/jpeg
  data: string; // base64（无 data: 前缀）
}

export interface IAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时：对应的 toolCall id。 */
  toolCallId?: string;
  /** role='assistant' 且模型请求调用工具时。 */
  toolCalls?: IAiToolCall[];
  /** role='user' 多模态：附带的图片（视觉模型消费；纯文本模型忽略）。 */
  images?: IAiImageAttachment[];
}

export interface IAiChatResponse {
  content: string;
  toolCalls?: IAiToolCall[];
  /** token 用量（成本核算，backlog #44 M2）；provider 未返回则缺省。 */
  usage?: { inputTokens: number; outputTokens: number };
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
  /** 供 Agent V3 把调用映射回画布上的真实工具节点；由引擎解析连接时注入。 */
  sourceNodeName?: string;
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
  /** 未求值的原始参数值（$fromAI 声明藏在表达式里,不能被提前解析——#19 AI 工具用）。 */
  getRawNodeParameter(name: string): unknown;
  getCredentials(type: string): Promise<JsonObject>;
  getWorkflowStaticData(type: string): JsonObject;
  /** 嵌套组合：子节点自己也可挂子节点（如 RAG 工具挂 embedding 模型）。 */
  getInputConnectionData(connectionType: string): Promise<unknown[]>;
  helpers: Pick<INodeExecutionHelpers, 'httpRequest' | 'binaryToBuffer' | 'bufferToBinary'>;
}

/**
 * poll 函数的 `this`（轮询型触发器）：周期被调度器调用，
 * 返回新 items（触发执行）或 null/空（本轮无新数据，不触发）。
 * filterNewKeys 是去重原语：传候选键，返回其中首次出现的（并记住它们）。
 */
export interface IPollContext {
  getNodeParameter(name: string): unknown;
  /** 轮询触发器按节点声明取解密凭证；实现由 server 以 projectId 归属边界注入。 */
  getCredentials(type: string): Promise<JsonObject>;
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
  /** 自定义 webhook 页面/载荷；无此方法时沿用通用 webhook JSON 行为。 */
  webhook?(this: IWebhookContext): Promise<IWebhookResult>;
  /** 轮询：返回新 items 触发执行；null/空 = 本轮无新数据。 */
  poll?(this: IPollContext): Promise<INodeExecutionData[][] | null>;
  /** 能力供给（ai_* 子节点）：宿主执行时被解析，返回模型/工具/记忆等能力对象。 */
  supplyData?(this: ISupplyDataContext): Promise<unknown>;
  /** credentialAuthentication.type=custom 时，在 HTTP 发送前最后改写请求。 */
  authenticate?(
    credentials: JsonObject,
    request: IHttpRequestOptions,
  ): IHttpRequestOptions | Promise<IHttpRequestOptions>;
  /** NDV 动态参数方法；仅由 server 的受保护代查端点调用。 */
  methods?: {
    loadOptions?: Record<string, (this: ILoadOptionsContext) => Promise<INodePropertyOption[]>>;
    resourceLocator?: Record<string, (this: IResourceLocatorContext) => Promise<IResourceLocatorResult>>;
    resourceMapping?: Record<string, (this: ILoadOptionsContext) => Promise<IResourceMapperFields>>;
  };
}

export interface ILoadOptionsContext {
  getCredentials(type: string): Promise<JsonObject>;
  getCurrentNodeParameter(name: string): unknown;
  helpers: {
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
    /** Dynamic parameter methods use the same project-scoped contract as execute(). */
    dataTables?: Pick<IDataTableOperations, 'list' | 'get'>;
  };
}

export interface IResourceLocatorContext extends ILoadOptionsContext {
  filter?: string;
  paginationToken?: string;
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
