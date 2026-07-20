# 02 — 数据模型与契约

本文件定义全项目的硬契约。所有模块围绕这些结构编程。**改这些结构前必须评估全局影响。**

---

## 一、数据库 Schema（Drizzle，PostgreSQL / SQLite 兼容）

### 归属边界表（Day-1 必须存在）

```typescript
// user
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),   // argon2
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('member'),  // owner | admin | member
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// project —— 归属容器。安装版默认一个 personal project / user
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull().default('personal'), // personal | team
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projectRelations = pgTable('project_relations', {
  projectId: uuid('project_id').notNull().references(() => projects.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(),  // project:owner | project:editor | project:viewer
});
```

### 核心业务表

```typescript
// workflow
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(false),
  nodes: jsonb('nodes').notNull(),           // INode[]  (见下方 workflow JSON)
  connections: jsonb('connections').notNull(),// IConnections
  settings: jsonb('settings'),               // 超时、错误工作流等
  staticData: jsonb('static_data'),          // 触发器持久状态（如 poll 游标）
  versionId: uuid('version_id'),             // 乐观锁 / 版本
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 归属关联（多对多，为 Cloud 多租户预留）
export const sharedWorkflows = pgTable('shared_workflows', {
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  role: text('role').notNull(),  // workflow:owner | workflow:editor
});

// credential
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),          // 对应 credential type 名，如 'httpBasicAuth'
  data: text('data').notNull(),          // ★加密后的字符串，绝不明文
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sharedCredentials = pgTable('shared_credentials', {
  credentialId: uuid('credential_id').notNull().references(() => credentials.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  role: text('role').notNull(),
});

// execution —— 每次运行
export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull(),
  status: text('status').notNull(),      // new|running|success|error|canceled|waiting
  mode: text('mode').notNull(),          // trigger|webhook|manual|retry
  startedAt: timestamp('started_at'),
  stoppedAt: timestamp('stopped_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// execution_data —— 大字段拆表（执行数据可能很大）
export const executionData = pgTable('execution_data', {
  executionId: uuid('execution_id').primaryKey().references(() => executions.id),
  workflowData: jsonb('workflow_data').notNull(),  // 执行时的 workflow 快照
  data: jsonb('data').notNull(),                   // RunExecutionData（见第四节）
});

// webhook 注册表（快速路由 webhook 请求到 workflow）
export const webhookEntities = pgTable('webhook_entities', {
  webhookPath: text('webhook_path').notNull(),
  method: text('method').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  node: text('node').notNull(),          // 哪个节点的 webhook
  // 复合主键 (webhookPath, method)
});

// settings —— 实例级 KV（含加密密钥、instanceId 等）
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  loadOnStartup: boolean('load_on_startup').notNull().default(false),
});
```

**索引要点**：`webhook_entities(webhook_path, method)` 唯一；`executions(workflow_id, created_at)`；`shared_workflows(project_id)`。

---

## 二、Workflow JSON 格式（前后端 + 引擎共用）

工作流序列化后长这样。这是 `workflows.nodes` / `workflows.connections` 字段的结构。

```typescript
interface INode {
  id: string;                    // 画布内唯一
  name: string;                  // 显示名，连接用它引用（唯一）
  type: string;                  // node type 名，统一 `nomops.` 前缀，如 `nomops.httpRequest`
  typeVersion: number;           // 节点版本，用于兼容升级
  position: [number, number];    // 画布坐标
  parameters: Record<string, any>;  // 用户填的参数（可含 {{表达式}}）
  credentials?: Record<string, { id: string; name: string }>;  // 引用的凭证
  disabled?: boolean;
  // 循环/容器用（参考基线无此，我们如需嵌套可加 parentId）
}

// 连接：从源节点的某输出，连到目标节点的某输入
interface IConnections {
  // key = 源节点 name
  [sourceNodeName: string]: {
    // key = 连接类型，主数据流为 'main'
    [type: string]: Array<Array<{
      node: string;      // 目标节点 name
      type: string;      // 目标输入类型，通常 'main'
      index: number;     // 目标输入端口索引
    }> | null>;
    // 外层数组索引 = 源节点的输出端口索引（IF 节点输出0=true, 输出1=false）
  };
}
```

**示例**：Webhook → IF →(true) HTTP →(false) Set

```json
{
  "nodes": [
    { "id": "a", "name": "Webhook", "type": "nomops.webhook", "typeVersion": 1, "position": [0,0], "parameters": { "path": "hook1" } },
    { "id": "b", "name": "IF", "type": "nomops.if", "typeVersion": 1, "position": [200,0], "parameters": { "conditions": [{ "left": "={{ $json.amount }}", "op": "gt", "right": 100 }] } },
    { "id": "c", "name": "HTTP", "type": "nomops.httpRequest", "typeVersion": 1, "position": [400,-50], "parameters": { "url": "https://api.example.com" } },
    { "id": "d", "name": "Set", "type": "nomops.set", "typeVersion": 1, "position": [400,50], "parameters": {} }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "IF", "type": "main", "index": 0 }]] },
    "IF": {
      "main": [
        [{ "node": "HTTP", "type": "main", "index": 0 }],
        [{ "node": "Set", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

---

## 三、节点定义 Schema（★节点系统的核心契约）

一个 node type = **声明式 description** + **execute 函数**。同一份 description 同时驱动：前端配置表单渲染、参数校验、执行。这是「加节点只写配置 + 一个函数」的关键。

```typescript
interface INodeType {
  description: INodeTypeDescription;
  // 动作/逻辑节点实现这个
  execute?(this: IExecuteContext): Promise<INodeExecutionData[][]>;
  // 触发器节点实现这个（webhook/cron/poll）
  trigger?(this: ITriggerContext): Promise<ITriggerResponse>;
  webhook?(this: IWebhookContext): Promise<IWebhookResponse>;
  poll?(this: IPollContext): Promise<INodeExecutionData[][] | null>;
}

interface INodeTypeDescription {
  displayName: string;          // "HTTP Request"
  name: string;                 // "httpRequest" → 全名 "nomops.httpRequest"
  group: string[];              // ['trigger'|'transform'|'output'...]
  version: number | number[];   // 支持多版本
  description: string;
  defaults: { name: string };   // 拖出时默认名
  inputs: string[];             // ['main'] —— 输入端口
  outputs: string[];            // ['main'] 或 ['main','main'] （IF 有两个输出）
  credentials?: Array<{ name: string; required?: boolean }>;
  webhooks?: IWebhookDescription[];   // webhook 节点用
  polling?: boolean;                  // poll 节点用
  properties: INodeProperties[];      // ★参数定义 → 前端表单
}

// 参数定义 —— 前端据此渲染表单控件
interface INodeProperties {
  displayName: string;          // 表单标签
  name: string;                 // 参数 key（存进 node.parameters）
  type: 'string' | 'number' | 'boolean' | 'options' | 'collection'
      | 'json' | 'dateTime' | 'color' | 'notice';
  default: any;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: Array<{ name: string; value: string }>;  // type=options 时
  // 条件显示：仅当其他参数满足条件时才显示本参数
  displayOptions?: {
    show?: Record<string, any[]>;
    hide?: Record<string, any[]>;
  };
  // 该字段是否支持 {{表达式}}
  noDataExpression?: boolean;
}
```

**最小节点示例（Set 节点，给每个 item 加字段）**：

```typescript
export class Set implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Set',
    name: 'set',
    group: ['transform'],
    version: 1,
    description: '给数据项设置字段',
    defaults: { name: 'Set' },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Fields',
        name: 'fields',
        type: 'collection',
        default: {},
      },
    ],
  };

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      const fields = this.getNodeParameter('fields', i) as Record<string, any>;
      returnData.push({
        json: { ...items[i].json, ...fields },
        pairedItem: { item: i },   // ★数据溯源：本输出来自第 i 个输入
      });
    }
    return [returnData];  // 外层数组 = 输出端口（Set 只有一个端口）
  }
}
```

---

## 四、执行状态结构（★引擎心脏，务必可序列化）

引擎不用递归，用显式状态。整个 `RunExecutionData` 必须能 `JSON.stringify` —— 这是暂停/恢复、崩溃恢复、队列模式的前提。

```typescript
// 数据流基本单位
interface INodeExecutionData {
  json: Record<string, any>;      // 主数据
  binary?: Record<string, IBinaryData>;  // 二进制（文件等）
  pairedItem?: IPairedItemData;   // 溯源：本 item 来自哪个输入 item
  error?: NodeApiError;
}

// 一个待执行/已执行的节点单元
interface IExecuteData {
  node: INode;
  data: ITaskDataConnections;     // 输入数据（按端口）
  source: ITaskDataConnectionsSource | null;  // 数据来自哪个上游
}

// ★引擎的完整状态 —— 一切都在这里，可整体序列化
interface IRunExecutionData {
  startData?: {
    destinationNode?: string;     // 只跑到这个节点（部分执行）
    runNodeFilter?: string[];     // 允许执行的节点白名单
  };
  resultData: {
    runData: IRunData;            // 每个节点的执行结果（输入/输出/耗时/错误）
    pinData?: IPinData;           // 调试用固定数据
    lastNodeExecuted?: string;
    error?: ExecutionError;
  };
  executionData?: {
    // ★就绪栈：输入已齐、可以执行的节点
    nodeExecutionStack: IExecuteData[];
    // ★等待表：多输入节点（如 Merge），等所有上游到齐才转入栈
    waitingExecution: IWaitingForExecution;
    waitingExecutionSource: IWaitingForExecutionSource;
  };
  resumeToken?: string;           // 暂停/恢复（Wait 节点）
}

// 每个节点每次运行的记录
interface IRunData {
  [nodeName: string]: ITaskData[];  // 数组因为循环里同一节点可多次运行
}
interface ITaskData {
  startTime: number;
  executionTime: number;
  data?: ITaskDataConnections;    // 输出数据（按端口）
  error?: ExecutionError;
  source: Array<{ previousNode: string } | null>;
}
```

**引擎主循环伪代码**（对应 `workflow-execute.ts`）：

```
run(workflow, startNode):
  初始化 nodeExecutionStack = [{ node: startNode, data: 种子数据 }]
  while nodeExecutionStack 非空:
    exec = stack.pop()
    if exec.node 的所有输入未到齐:      # 多输入节点
       转入 waitingExecution，continue
    output = runNode(exec)              # 跑 execute()
       捕获错误 → 若 continueOnError 走 error 输出端口，否则终止
    记录到 resultData.runData[node]
    assignPairedItems(output)           # 溯源
    for 每个下游连接:
       if 下游输入齐了: 压入 stack
       else: 存入 waitingExecution
  # 栈空 → 收尾，组装最终 IRun 结果
```

**这段循环是全项目最难的代码，也是最核心的资产。** 详细实现规范见 `03-MODULES.md` 第 4 节。
