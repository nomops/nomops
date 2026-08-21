# 03 — 模块开发规范

六个内核模块 + 一个横切模块。按依赖顺序开发：**先地基（1、2），再中层（3、4），后上层（5、6）**。每节含：职责、接口契约、关键实现点、验收标准。

依赖关系（箭头 = 依赖）：
```
6 REST API ──> 5 触发器管理 ──> 4 引擎 ──> 1 节点加载器
                              └─> 3 凭证 ──> 2 数据层
7 表达式引擎（横切，被 4 调用）
```

---

## 模块 1 — 节点加载器（Node Loader）

**职责**：扫描节点目录/包，实例化节点类，注册进类型表，供引擎和前端查询。是平台可扩展性的地基。

**接口契约**
```typescript
interface INodeLoader {
  loadAll(): Promise<void>;                          // 启动时扫描
  getByNameAndVersion(type: string, version?: number): INodeType;
  getAllDescriptions(): INodeTypeDescription[];      // 前端拉节点面板用
  loadPackage(pkg: string): Promise<void>;           // 运行时动态加载
  unloadPackage(pkg: string): Promise<void>;
}
```

**关键实现点**
- **懒加载**：启动时只读每个节点的 `description`（轻量），不 `new` 全部。`execute` 函数第一次用到时才加载类。50+ 节点时启动性能全靠这个。
- **隔离加载**：不同节点包可能依赖冲突的库版本，用独立 require 上下文加载，避免污染。
- **热重载**（dev 模式）：监听节点目录，改动后重新加载单个节点，无需重启。
- 节点全名规则：`nomops.<name>`（内置）或 `<pkgName>.<name>`（社区包）。

**验收**：启动后 `getAllDescriptions()` 返回全部内置节点；`getByNameAndVersion('nomops.set', 1)` 能拿到可执行的 Set 类；改一个节点文件后 dev 模式自动生效。

---

## 模块 2 — 数据持久层（DB / Repository）

**职责**：Drizzle schema + repository 封装。业务层不直接碰 ORM。

**接口契约**（每个实体一个 repository）
```typescript
interface IWorkflowRepository {
  findById(id: string, projectId: string): Promise<Workflow | null>;  // ★带归属过滤
  findAllByProject(projectId: string): Promise<Workflow[]>;
  create(data: NewWorkflow, projectId: string): Promise<Workflow>;
  update(id: string, data: Partial<Workflow>): Promise<Workflow>;
  delete(id: string): Promise<void>;
}
// ExecutionRepository / CredentialRepository / WebhookRepository 同理
```

**关键实现点**
- **归属过滤内建在 repository**：`findById` 强制传 `projectId`，SQL 里 join `shared_workflows` 过滤。这样 Cloud 多租户不用改业务代码——权限在数据访问层就拦住了。
- SQLite 与 PostgreSQL 双兼容：用 Drizzle 的 dialect 抽象，避免 PG 专有语法。JSON 字段 SQLite 用 text、PG 用 jsonb，Drizzle 处理。
- 迁移用 `drizzle-kit`，纳入 CI。
- `execution_data` 与 `executions` 拆表（大字段隔离）。

**验收**：切换 `DB_TYPE=sqlite|postgres` 环境变量，同一套 repository 代码都能跑通迁移和 CRUD；跨 project 查不到别人的 workflow。

---

## 模块 3 — 凭证系统（Credentials）

**职责**：加密存储 / 解密注入第三方凭证。两层设计。

**接口契约**
```typescript
// core 层：只管加解密
class Credentials {
  constructor(private cipher: Cipher) {}
  async encrypt(data: object): Promise<string>;
  async decrypt(encrypted: string): Promise<object>;
}

// ★密钥来源抽象 —— 安装版 vs Cloud 的唯一分叉点
interface IEncryptionKeyProvider {
  getKey(context?: { projectId?: string }): Promise<Buffer>;
}
// 安装版实现：从 settings 表读实例密钥
// Cloud 实现：从 KMS / 每租户密钥读

// server 层：业务
interface ICredentialService {
  create(data, type, projectId): Promise<Credential>;
  getDecryptedData(id: string, projectId: string): Promise<object>;  // 执行时用
  test(id: string): Promise<{ ok: boolean; message?: string }>;      // 测试连接
}
```

**关键实现点**
- 加密算法：AES-256-GCM。密钥永远经 `IEncryptionKeyProvider` 取，**绝不写死**。
- `credentials.data` 字段存密文；API 返回给前端时**永不含解密后的敏感字段**（只返回非敏感的、或掩码）。
- 执行时：引擎通过节点 `description.credentials` 声明知道要哪些凭证，向凭证服务请求解密数据，注入进节点执行上下文。

**验收**：凭证明文永不落库、永不出 API；换 `IEncryptionKeyProvider` 实现，业务代码零改动。

---

## 模块 4 — 工作流引擎（Engine）★最核心

**职责**：给定 workflow + 起始数据，按 DAG 执行完，返回可序列化的 `RunExecutionData`。纯计算，不碰 HTTP、不碰 DB。

**接口契约**
```typescript
class WorkflowExecute {
  constructor(
    private nodeLoader: INodeLoader,
    private additionalData: IAdditionalData,  // 注入：凭证取用、hooks、日志
  ) {}

  // 从头跑
  run(workflow: Workflow, startNode?: INode, destinationNode?: string): Promise<IRun>;
  // 从已有状态继续跑（恢复/队列 worker 用）
  processRunExecutionData(workflow: Workflow): PCancelable<IRun>;
}
```

**关键实现点（照 `02-DATA-MODEL.md` 第四节的状态结构）**
1. **栈驱动，非递归**。`nodeExecutionStack` 是就绪栈，`waitingExecution` 是多输入等待表。理由：状态可序列化 → 可暂停/恢复/入队。
2. **多输入汇合（Merge 语义）**：节点有多个上游输入端口时，先进 `waitingExecution`，每有一路输入到达记一笔，齐了才转入就绪栈。这是最易出并发 bug 的地方，重点测试。
3. **错误处理**：节点抛错时，看该节点 `continueOnError` 配置——是则把错误数据从「错误输出端口」放出去继续；否则终止整个执行并记录。
4. **item 数据流**：节点输入输出都是 `INodeExecutionData[]`。天然支持「1 条输入 → 展开 N 条 → 逐条处理」。
5. **pairedItem 溯源**：每个输出 item 记录来自哪个输入 item。支撑前端「回溯某条数据的来路」和表达式 `$('NodeName').item`。
6. **部分执行**：`destinationNode` 给定时，先算出它的所有父节点集合作为 `runNodeFilter`，只跑集合内节点。前端「运行到此节点」靠这个。
7. **取消**：`processRunExecutionData` 返回 `PCancelable`，支持中途取消（用户点停止）。
8. **hooks**：每个节点执行前后触发 hook（`nodeExecuteBefore/After`），server 层挂上去做「WebSocket 推进度」「写 execution 记录」。引擎本身不知道这些，只调 hook。
9. **Agent V3 工具调度**：AiAgent 不在节点内直接调用工具。模型产生的 tool call 被封装成可序列化 `ExecutionAiToolRequest`，主循环把真实 `ai_tool` 子节点压栈；工具沿用节点 retry、AbortSignal、HITL waiting/resume 与 hooks，并以独立 runData（含 call id/工具名/父 Agent）写入执行详情。Agent 状态保存在 `contextData`，跨暂停或队列 worker 恢复时不会重跑已完成轮次。

**节点执行上下文（execute 函数里的 `this`）**
```typescript
interface IExecuteContext {
  getNode(): INode;
  getInputData(inputIndex?: number): INodeExecutionData[];
  getNodeParameter(name: string, itemIndex: number): any;  // ★自动求值表达式
  getCredentials(type: string): Promise<object>;           // 解密后的凭证
  getWorkflowStaticData(type: string): object;             // 触发器持久状态
  helpers: {                                               // 通用工具
    httpRequest(opts): Promise<any>;
    // ...
  };
}
```

**出站 URL 信任边界**：节点参数、表达式或 AI 实参能影响目标 URL 时，调用 `httpRequest` / `openEventStream` 必须传 `urlTrust: 'user-controlled'`。`core` 会在真实连接的 DNS `lookup` 与每次重定向时拒绝回环、RFC1918、链路本地、云 metadata、IPv6 ULA 等非公网地址。只有代码内固定的服务目标可保持默认 `trusted`；不得根据用户参数把请求降级为 trusted。

**项目级 Data Table 边界**：Data Table 节点只通过 `helpers.dataTables` 使用服务端注入的当前项目操作集；节点参数和表达式不得传入或覆盖 `projectId`。动态 Data table locator 与 resource mapper schema 也必须由认证端点按当前项目查询，并在执行时再次校验表归属，不能信任前端返回的表 ID。列映射 schema 由表定义动态生成，NDV 和执行器共享字段名与类型约束。

**Nomops 自 API 边界**：Nomops 节点只通过 `helpers.nomopsApiRequest` 使用服务端枚举的本实例操作，节点不得提供 URL、路径或 `projectId`。目标固定为管理员配置的 `NOMOPS_BASE_URL` 下 `/api/v1`；服务端强制附加当前执行项目，并以节点显式选择的 `nomopsApi` 凭证调用正常 API 鉴权链。API Key scopes、项目成员关系和 RBAC 同时生效，不存在隐式管理员身份。跨域重定向必须剥离 `X-Nomops-Api-Key` 与 `X-Project-Id`。

**验收**：
- 无 HTTP/DB 环境下，单测能跑通线性、分支（IF）、合并（Merge）、循环、错误续跑五种拓扑。
- 一个执行到一半的 `RunExecutionData` 能 `JSON.stringify` 后反序列化、`processRunExecutionData` 继续跑完，结果与不中断一致。

---

## 模块 5 — 触发器管理（Trigger / Activation）

**职责**：工作流「激活」时注册其触发器，「停用」时注销。触发时调引擎跑一次。

**接口契约**
```typescript
class ActiveWorkflowManager {
  add(workflowId: string, mode: 'init' | 'update' | 'activate'): Promise<void>;
  remove(workflowId: string): Promise<void>;
  // 触发器触发 → 调这个统一入口
  private runWorkflow(workflowId, triggerNode, data): Promise<void>;
}
```

**关键实现点**
- **两类触发器分治**：
  - **Webhook 型**（无状态）：激活时把 `(path, method) → workflowId` 写入 `webhook_entities` 表。外部请求进 `/webhook/:path` 时查表路由。任意进程可接。
  - **定时/轮询型**（有状态）：激活时起 cron 定时器 / poll 循环。**队列模式下只有 leader 进程能起**，否则一个 cron 触发 N 次。
- 激活失败要记录 `activationError` 并在 UI 显示（如 webhook path 冲突）。
- 触发 → 构造起始数据 → 单进程直接调引擎 / 队列模式入队。
- Nomops Trigger 只接收管理器注入的 `init` / `activate` / `update` 生命周期，不订阅跨项目全局事件；输出仅含事件名、时间与当前 workflow id/name。

**验收**：激活一个 Webhook 工作流后，外部 POST 能触发执行；激活一个 Cron 工作流后按时触发；停用后不再触发；模拟双进程，同一 cron 只触发一次。

---

## 模块 6 — REST API 层（Controllers）

**职责**：HTTP 端点。薄 controller（鉴权 + 校验 + 调 service），厚 service（业务）。

**核心端点**
```
POST   /auth/login                  登录，发 JWT
GET    /workflows                   列表（按当前 project 过滤）
POST   /workflows                   创建
GET    /workflows/:id               详情
PATCH  /workflows/:id               更新（保存画布）
POST   /workflows/:id/activate      激活/停用
POST   /workflows/:id/run           手动运行（body 可带 destinationNode）
GET    /node-types                  所有节点 description（前端节点面板）
POST   /credentials                 创建凭证
POST   /credentials/:id/test        测试连接
GET    /templates                   内置模板摘要（含凭证要求）
POST   /templates/:id/import        导入模板为项目工作流
POST   /templates/:id/setup         按声明安全绑定项目凭证
POST   /dynamic-node-parameters/resource-mapper-fields  动态列映射 schema（按项目）
GET    /executions                  执行历史
GET    /executions/:id              执行详情（含 RunExecutionData）
POST   /executions/:id/retry        重跑
*      /webhook/:path               webhook 入口（无需鉴权，按 path 路由）
WS     /ws                          执行进度实时推送
```

**关键实现点**
- controller 用装饰器风格注册路由（`@Get`/`@Post` + 一个 registry）。
- 每个受保护端点走鉴权中间件解析 JWT → 注入当前 user + project。
- **入参用 Zod 校验**；workflow 保存时校验 JSON 结构（节点引用是否存在、连接是否合法、有无环——除非是合法循环）。
- WebSocket：执行时引擎 hook → 通过 WS 把每个节点的输入输出推给正在看的前端。
- 模板凭证向导只接收凭证 ID；服务端重新校验当前项目归属与声明类型，再把凭证引用绑定到模板声明的节点。前端仅在同类型唯一候选或唯一同名候选时自动选择，歧义必须由用户决定，并保留 Skip setup 路径。
- workflow 内容行维护独立的单调递增 `version`。编辑器保存携带已读取版本，repository 使用 `WHERE id = ? AND version = ?` 原子更新并在成功时 `version + 1`；条件不命中返回 HTTP 409，绝不以末位写静默覆盖另一会话。运行期 `staticData` 等内部写入不改变内容版本，避免制造无关编辑冲突。

**验收**：Postman/curl 能完成「登录 → 建工作流 → 激活 → 触发 → 查执行历史」全流程；未登录访问受保护端点返回 401；跨 project 访问返回 403/404。

---

## 模块 7 — 表达式引擎（横切）

**职责**：求值节点参数里的 `{{ ... }}`。被引擎在解析节点参数时调用。

**语法**：`{{ $json.field }}`、`{{ $node["Webhook"].json.x }}`、`{{ $now.plus({ days: 1 }) }}`、`{{ items.length }}` 等。表达式里能访问：当前 item（`$json`）、其他节点输出（`$node`/`$(...)`）、内置变量（`$now`/`$today`/`$timezone`/`$workflow`）、JS 表达式子集。

**DateTime 与扩展方法**：`$now`/`$today` 按工作流时区构造为 Luxon-compatible DateTime，支持 `plus/minus/startOf/endOf/toISO/toFormat`。String/Array/Object/Number 的首批高频方法（例如 `isEmail/first/sum/compact/isEven`）不修改原型，而由 Babel AST 把 `value.method(args)` 改写为白名单 `__extend(value, method, args)` 后送入同一个 QuickJS 沙箱。扩展的说明、类型、返回值和示例集中在 `EXPRESSION_EXTENSION_DOCS`，前端方法补全直接消费该元数据。

**同构预览**：NDV 的 Result 面板直接调用 workflow 包的 `resolveParameterValue`，输入当前 item、最近一次完整 runData 和工作流元信息，所以 `$node`/`$(...)` 与真正执行同口径。编辑后先进入 `pending`，随后显示 `success` 真值或 `error` 沙箱错误；方法补全与 `$json` 字段树来自真实输入数据和上述扩展元数据。

**关键实现点**
- **必须沙箱化**：表达式里可能有用户输入，绝不能 `eval` 到全局。用隔离的求值环境（如 `vm` 模块的受限上下文，或专用表达式库），禁止访问 `process`、`require`、文件系统。
- 建议不要从零写 AST parser（成本极高）。可基于成熟表达式求值库封装，只暴露白名单变量和方法。
- 求值失败要给出清晰错误（哪个参数、哪个表达式、什么原因），前端能定位。

**验收**：`{{ $json.a + 1 }}` 在 `{a:1}` 上求值为 2；`{{ $now.plus({ days: 1 }) }}` 与 `{{ 'dev@example.com'.isEmail() }}` 可用；`{{ process.exit() }}` 被沙箱拦截报错；引用不存在的节点给出可读错误；NDV 预览与真实 API 工作流输出一致。

---

## Code 节点（安全重点）

`Code` 节点让用户写 JS 跑在工作流里，是安全高风险点。

- **单进程 MVP**：可用 `vm` 沙箱临时方案，但要意识到 Node `vm` 不是安全边界。
- **生产**：必须独立进程/容器隔离执行（参考成熟方案的 task-runner 模式——单独进程跑用户代码，通过 IPC 通信）。列入 Phase 2。
- 禁止用户代码访问文件系统、网络（除非显式放行）、环境变量。
