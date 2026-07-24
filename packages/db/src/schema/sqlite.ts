import { randomUUID } from 'node:crypto';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { IConnections, INode, IPinData, IWorkflowSettings, JsonObject } from '@nomops/workflow';

/**
 * SQLite 方言 schema（docs/02-DATA-MODEL.md 第一节）。
 * 与 pg.ts 表名/列名一致。类型映射：
 *   uuid → text(+randomUUID)，jsonb → text{mode:json}，boolean → integer{mode:boolean}，
 *   timestamp → integer{mode:timestamp}。
 */

const uuidPk = (name: string) =>
  text(name)
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const users = sqliteTable('users', {
  id: uuidPk('id'),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('member'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false), // SCIM deactivate（docs/07）
  // 两步验证（TOTP）：secret 待确认时存在但 enabled=false；备份码存 sha256 哈希数组。
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  mfaSecret: text('mfa_secret'),
  mfaBackupCodes: text('mfa_backup_codes', { mode: 'json' }).$type<string[]>(),
  // 最近活跃时刻（每次鉴权请求节流更新;Users 列表显示 Last Active，D146）
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),
  // 每用户偏好（backlog #43）：落库替 localStorage,跨设备一致。可空（读取处 ?? {}），
  // 避免向已有数据的表 ADD NOT NULL 列失败。
  settings: text('settings', { mode: 'json' }).$type<JsonObject>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Agents 平台 · agent 定义（backlog #44 M1，docs/12）：项目级共享,有版本、可发布/回滚。
 * config 引用模型/工具/记忆策略(不内联),M1 仅需 { system, model? }。
 */
export const agents = sqliteTable(
  'agents',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    publishedVersionId: text('published_version_id'),
    active: integer('active', { mode: 'boolean' }).notNull().default(false),
    // #44 M2：agent 运行经引擎跑的后备工作流(ChatTrigger→AiAgent→ChatModel,按 config 组装)
    backingWorkflowId: text('backing_workflow_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agents_project_id_idx').on(t.projectId)],
);

/** Agents 平台 · 记忆条目（backlog #44 M3）：scope 分层(thread<agent<global),embedding 存 JSON。 */
export const memoryEntries = sqliteTable(
  'memory_entries',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    threadId: text('thread_id'), // scope=thread 时限定线程
    scope: text('scope').notNull().default('agent'), // thread|agent|global
    kind: text('kind').notNull().default('fact'), // fact|summary|preference
    content: text('content').notNull(),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>().notNull().$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  },
  (t) => [index('memory_entries_agent_idx').on(t.agentId)],
);

/** Agents 平台 · 记忆证据链（backlog #44 M3）：某条记忆源自哪次运行、依据什么观察。 */
export const memoryObservations = sqliteTable(
  'memory_observations',
  {
    id: uuidPk('id'),
    entryId: text('entry_id')
      .notNull()
      .references(() => memoryEntries.id),
    runId: text('run_id').notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('memory_observations_entry_idx').on(t.entryId)],
);

/**
 * Agents 平台 · 定时任务定义（backlog #44 M4）：agent 的周期指令。schedule 复用 #38 的
 * config 形态({mode:'cron'|'interval'|'once',...});每个任务 upsert 一条 scheduled_job
 * (kind=agent-task,config.taskId 回链),触发去重靠 #38 租约(docs/12 决策：不建 run_lock)。
 */
export const agentTaskDefinitions = sqliteTable(
  'agent_task_definitions',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    projectId: text('project_id').notNull(), // 冗余存,fire 侧免 join 拿归属
    name: text('name').notNull(),
    message: text('message').notNull(), // 每次触发发给 agent 的指令
    schedule: text('schedule', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    timezone: text('timezone').notNull().default('UTC'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    jobId: text('job_id'), // 对应 scheduled_jobs.id（松耦合,不建 FK,同 workflowId 惯例）
    threadId: text('thread_id'), // 专属线程：历次触发的 run 聚在一条线程里可回看
    lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_task_definitions_agent_idx').on(t.agentId)],
);

/** Agents 平台 · 文件（backlog #44 M5）：agent 上传/产出的文件,binaryId 复用 #32 binaryStore。 */
export const agentFiles = sqliteTable(
  'agent_files',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    threadId: text('thread_id'), // 产出自某线程时回链（可空）
    binaryId: text('binary_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull().default('application/octet-stream'),
    size: integer('size').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_files_agent_idx').on(t.agentId)],
);

/**
 * Agents 平台 · 外部渠道订阅（backlog #44 M5）：type=telegram 时 bot token 存凭证系统
 * (credentialId,铁律 3 解密即用即弃),config 存 webhookSecret 等非密设置。
 */
export const agentChannels = sqliteTable(
  'agent_channels',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    projectId: text('project_id').notNull(), // 冗余存,webhook 侧免 join 拿归属
    type: text('type').notNull(), // telegram|slack|…
    credentialId: text('credential_id').notNull(),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_channels_agent_idx').on(t.agentId)],
);

/** Agents 平台 · 会话线程（backlog #44 M2）：跨多次运行的上下文边界。 */
export const agentThreads = sqliteTable(
  'agent_threads',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    projectId: text('project_id').notNull(),
    channel: text('channel').notNull().default('canvas'), // canvas|telegram|task
    externalRef: text('external_ref'),
    title: text('title').notNull().default('New thread'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_threads_agent_idx').on(t.agentId)],
);

/** Agents 平台 · 一次 agent 运行（backlog #44 M2）：链到 execution,带 token/成本账。 */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => agentThreads.id),
    agentId: text('agent_id').notNull(),
    executionId: text('execution_id'),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0), // 成本(百万分之一货币单位)
    model: text('model').notNull().default(''),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_runs_thread_idx').on(t.threadId)],
);

/** Agents 平台 · 线程消息（backlog #44 M2）。 */
export const agentMessages = sqliteTable(
  'agent_messages',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => agentThreads.id),
    runId: text('run_id'),
    role: text('role').notNull(), // user|assistant
    content: text('content', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_messages_thread_idx').on(t.threadId)],
);

/** Agents 平台 · 发布版本史（backlog #44 M1）：同 workflow_versions 的版本快照模式。 */
export const agentHistory = sqliteTable(
  'agent_history',
  {
    id: uuidPk('id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull(),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('agent_history_agent_idx').on(t.agentId)],
);

/**
 * AI 建流会话（backlog #45 M1，docs/13 组 A）：用户用自然语言多轮迭代出一个工作流。
 * messages 存对话历史（服务端权威,不信客户端回传全量）;每产出一版草稿建一条临时流 revision。
 * 临时流不进 workflows 表（防列表污染+误激活）,Apply 时才物化为正式 workflow。
 */
export const workflowBuilderSessions = sqliteTable(
  'workflow_builder_sessions',
  {
    id: uuidPk('id'),
    userId: text('user_id').notNull(),
    projectId: text('project_id').notNull(),
    title: text('title').notNull().default('New builder session'),
    goal: text('goal').notNull().default(''),
    status: text('status').notNull().default('active'), // active|applied|discarded
    messages: text('messages', { mode: 'json' }).$type<JsonObject[]>().notNull().$defaultFn(() => []),
    currentRevisionId: text('current_revision_id'), // 当前预览/回退到的草稿版本
    appliedWorkflowId: text('applied_workflow_id'), // Apply 后物化的正式 workflow
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('workflow_builder_sessions_project_idx').on(t.projectId)],
);

/** AI 建流会话 · 临时草稿（backlog #45 M1）：每轮产出一版,revision 递增 → 可回退到任一轮。 */
export const aiBuilderTemporaryWorkflows = sqliteTable(
  'ai_builder_temporary_workflows',
  {
    id: uuidPk('id'),
    sessionId: text('session_id')
      .notNull()
      .references(() => workflowBuilderSessions.id),
    revision: integer('revision').notNull(),
    name: text('name').notNull(),
    nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
    connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
    summary: text('summary').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('ai_builder_temporary_workflows_session_idx').on(t.sessionId)],
);

/**
 * 有检查点的 AI 线程（backlog #45 M2，docs/13 组 B）：实例助手的底座。
 * state 是线程当前的可序列化工作态（铁律 4，JSON.stringify 安全）;检查点存整段快照,可回滚续跑。
 */
export const instanceAiThreads = sqliteTable(
  'instance_ai_threads',
  {
    id: uuidPk('id'),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull().default('ops'), // ops|builder
    title: text('title').notNull().default('New thread'),
    state: text('state', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})), // 当前工作态
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_threads_user_idx').on(t.userId)],
);

/** AI 线程消息（backlog #45 M2）：追加日志,seq 递增;回滚时截断 seq > 检查点 messageCount 的。 */
export const instanceAiMessages = sqliteTable(
  'instance_ai_messages',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => instanceAiThreads.id),
    seq: integer('seq').notNull(), // 1-based 顺序
    role: text('role').notNull(), // user|assistant|tool|system
    content: text('content', { mode: 'json' }).$type<JsonObject>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_messages_thread_idx').on(t.threadId)],
);

/**
 * AI 线程检查点（backlog #45 M2）：某步的完整可序列化状态快照（铁律 4，同 RunExecutionData 哲学）。
 * restore 时把线程 state 还原、并截断 messageCount 之后的消息 → 线程回到该检查点,状态一致,可续跑。
 */
export const instanceAiCheckpoints = sqliteTable(
  'instance_ai_checkpoints',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => instanceAiThreads.id),
    seq: integer('seq').notNull(), // 检查点序号(1-based)
    label: text('label').notNull().default(''),
    state: text('state', { mode: 'json' }).$type<JsonObject>().notNull(), // 快照时的 thread.state
    messageCount: integer('message_count').notNull(), // 快照时的消息条数(回滚截断依据)
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_checkpoints_thread_idx').on(t.threadId)],
);

/**
 * HITL 待确认动作（backlog #45 M3，docs/13 组 C）：助手的危险/不可逆/外发动作先挂 pending,
 * 人在 UI 确认后才执行——沿用平台「外发前确认」安全边界。安全(只读)动作不落此表,直接执行。
 */
export const instanceAiPendingActions = sqliteTable(
  'instance_ai_pending_actions',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => instanceAiThreads.id),
    tool: text('tool').notNull(),
    args: text('args', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    risk: text('risk').notNull().default('dangerous'), // 落表的都是 dangerous
    reason: text('reason').notNull().default(''), // 为何需要确认
    status: text('status').notNull().default('pending'), // pending|approved|rejected
    result: text('result', { mode: 'json' }).$type<JsonObject>(), // 批准执行后的结果
    decidedBy: text('decided_by'), // 确认/拒绝者 userId
    decidedAt: integer('decided_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_pending_actions_thread_idx').on(t.threadId)],
);

/**
 * AI 助手运行树（backlog #45 M4，docs/13 组 B）：一次助手动作的调用树（工具→子调用），供「观察」。
 * parentId 自引用成树;每节点记 input/output/status。
 */
export const instanceAiRunTree = sqliteTable(
  'instance_ai_run_tree',
  {
    id: uuidPk('id'),
    threadId: text('thread_id')
      .notNull()
      .references(() => instanceAiThreads.id),
    parentId: text('parent_id'), // 自引用（根节点为 null）
    label: text('label').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    output: text('output', { mode: 'json' }).$type<JsonObject>(), // 完成后填
    status: text('status').notNull().default('running'), // running|success|error
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
  },
  (t) => [index('instance_ai_run_tree_thread_idx').on(t.threadId)],
);

/**
 * AI 助手观察-反思记忆（backlog #45 M4）：助手从运行里提炼经验,embedding 检索。
 * 与 #44 memory_entries 同构,共用 embedding.ts。scope=instance 跨线程可召回(按 userId);
 * scope=thread 仅本线程。
 */
export const instanceAiMemory = sqliteTable(
  'instance_ai_memory',
  {
    id: uuidPk('id'),
    userId: text('user_id').notNull(),
    threadId: text('thread_id'), // scope=thread 时限定线程
    scope: text('scope').notNull().default('instance'), // instance|thread
    kind: text('kind').notNull().default('observation'), // observation|reflection
    content: text('content').notNull(),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>().notNull().$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_memory_user_idx').on(t.userId)],
);

/**
 * 助手连接的 MCP server（backlog #45 M5，docs/13 组 C）：挂一个 MCP server → 其工具进工具集。
 * config 存连接配置(含 token,不出 API/不进日志——铁律 3 精神);tools 缓存连接时发现的工具清单。
 * 候选源 = #43 mcp_registry_server 缓存。
 */
export const instanceAiMcpConnections = sqliteTable(
  'instance_ai_mcp_connections',
  {
    id: uuidPk('id'),
    userId: text('user_id').notNull(),
    threadId: text('thread_id'), // 线程域连接（可空 = 实例级）
    serverName: text('server_name').notNull(),
    url: text('url').notNull(),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    status: text('status').notNull().default('connected'), // connected|error|disconnected
    tools: text('tools', { mode: 'json' }).$type<Array<{ name: string; description: string }>>().notNull().$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('instance_ai_mcp_connections_user_idx').on(t.userId)],
);

/** 实例升级史（backlog #43）：每次启动检测版本变化即记一条。 */
export const instanceVersionHistory = sqliteTable('instance_version_history', {
  id: uuidPk('id'),
  version: text('version').notNull(),
  recordedAt: integer('recorded_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** MCP registry 缓存（backlog #43）：缓存外部 registry 的 server 目录,减少远程往返。 */
export const mcpRegistryServer = sqliteTable('mcp_registry_server', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default(''),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 文件夹打标（backlog #43）：文件夹 ↔ 标签 多对多,复用现有 tags。 */
export const folderTagMapping = sqliteTable(
  'folder_tag_mapping',
  {
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.tagId] })],
);

// 公共 REST API 令牌：存 token 的 sha256 哈希，明文仅创建时返回一次（铁律 3）。
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: uuidPk('id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    // 过期时间（null=永不过期）与作用域（all|readonly），鉴权时强制
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    scope: text('scope').notNull().default('all'),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

// 密码重置票据（自托管）：存 token 的 sha256 哈希，一次性、带过期（铁律 3 延伸）。
export const passwordResets = sqliteTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// 用户邀请（自托管：owner/admin 邀请 → 邀请链接 → 接受时才建 users 行）。
// 存 token 的 sha256 哈希（铁律 3）；未接受的邀请即「pending 用户」，在用户列表里合并展示。
export const invitations = sqliteTable('invitations', {
  id: uuidPk('id'),
  email: text('email').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role').notNull().default('member'),
  invitedBy: text('invited_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable('projects', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  type: text('type').notNull().default('personal'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectRelations = sqliteTable(
  'project_relations',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const workflows = sqliteTable('workflows', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
  connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
  settings: text('settings', { mode: 'json' }).$type<IWorkflowSettings>(),
  staticData: text('static_data', { mode: 'json' }).$type<JsonObject>(),
  // 钉住数据（nodeName → 冻结输出 items）；仅手动运行应用
  pinData: text('pin_data', { mode: 'json' }).$type<IPinData>(),
  versionId: text('version_id'),
  // 收藏（列表置顶星标）与归档（软删除：默认列表隐藏、触发器下线；基线语义 Delete 仅对 archived 开放）
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  // 发布/草稿分离：生产触发跑 publishedVersionId 指向的版本快照；null = 从未发布（生产退回当前定义，兼容旧数据）
  publishedVersionId: text('published_version_id'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  // 所属文件夹；null = 项目根。归属/嵌套由服务层校验，不加 FK。
  folderId: text('folder_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 工作流版本历史：每次编辑保存快照一份，可查看/回滚。projectId 冗余存以便归属过滤。
export const workflowVersions = sqliteTable(
  'workflow_versions',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    nodes: text('nodes', { mode: 'json' }).$type<INode[]>().notNull(),
    connections: text('connections', { mode: 'json' }).$type<IConnections>().notNull(),
    settings: text('settings', { mode: 'json' }).$type<IWorkflowSettings>(),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('workflow_versions_workflow_idx').on(t.workflowId)],
);

// 工作流文件夹：项目内组织工作流，支持嵌套（parent_folder_id 自引用，app 层校验）。
export const folders = sqliteTable(
  'folders',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    parentFolderId: text('parent_folder_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('folders_project_idx').on(t.projectId)],
);

// 已安装社区节点包（community nodes）：实例级（非项目归属），bootstrap 时据此重载。
export const installedNodes = sqliteTable('installed_nodes', {
  packageName: text('package_name').primaryKey(),
  version: text('version').notNull(),
  nodeTypes: text('node_types', { mode: 'json' }).$type<string[]>().notNull(),
  installedBy: text('installed_by'),
  installedAt: integer('installed_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sharedWorkflows = sqliteTable(
  'shared_workflows',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.projectId] }),
    index('shared_workflows_project_id_idx').on(t.projectId),
  ],
);

export const credentials = sqliteTable('credentials', {
  id: uuidPk('id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  data: text('data').notNull(), // 加密后的密文，绝不明文
  // 动态凭证（backlog #46）：resolvable 时运行时按 subject 经解析器取值,不用 data。为空 = 老行为。
  isResolvable: integer('is_resolvable', { mode: 'boolean' }).notNull().default(false),
  resolverId: text('resolver_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * 动态凭证解析器（backlog #46 M1，docs/14）：把一个逻辑凭证在运行时按 subject 解析成不同值。
 * kind=table：值存 dynamic_credential_entries；kind=http：运行时打宿主端点取值（M2）。
 */
export const dynamicCredentialResolvers = sqliteTable(
  'dynamic_credential_resolvers',
  {
    id: uuidPk('id'),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('table'), // table|http
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('dynamic_credential_resolvers_project_idx').on(t.projectId)],
);

/** 动态凭证 · 按 subject 的凭证值（backlog #46 M1）：data 是密文（复用凭证加密栈）。 */
export const dynamicCredentialEntries = sqliteTable(
  'dynamic_credential_entries',
  {
    id: uuidPk('id'),
    resolverId: text('resolver_id')
      .notNull()
      .references(() => dynamicCredentialResolvers.id),
    subject: text('subject').notNull(), // 租户/终端用户标识串
    data: text('data').notNull(), // 加密后的密文，绝不明文
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('dynamic_credential_entries_resolver_subject_idx').on(t.resolverId, t.subject)],
);

export const sharedCredentials = sqliteTable(
  'shared_credentials',
  {
    credentialId: text('credential_id')
      .notNull()
      .references(() => credentials.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialId, t.projectId] }),
    index('shared_credentials_project_id_idx').on(t.projectId),
  ],
);

export const variables = sqliteTable(
  'variables',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('variables_project_id_idx').on(t.projectId)],
);

export const dataTables = sqliteTable(
  'data_tables',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    columns: text('columns', { mode: 'json' })
      .$type<Array<{ name: string; type: string }>>()
      .notNull()
      .$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('data_tables_project_id_idx').on(t.projectId)],
);

export const dataTableRows = sqliteTable(
  'data_table_rows',
  {
    id: uuidPk('id'),
    dataTableId: text('data_table_id')
      .notNull()
      .references(() => dataTables.id),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('data_table_rows_table_id_idx').on(t.dataTableId)],
);

export const executions = sqliteTable(
  'executions',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id').notNull(),
    status: text('status').notNull(),
    mode: text('mode').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
    // waiting 状态的唤醒时刻；null = 等外部信号（resume API）。毫秒精度（timestamp 模式是秒，短等待会被截断）
    waitTill: integer('wait_till', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('executions_workflow_id_created_at_idx').on(t.workflowId, t.createdAt)],
);

export const executionData = sqliteTable('execution_data', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => executions.id),
  workflowData: text('workflow_data', { mode: 'json' }).$type<JsonObject>().notNull(),
  data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
});

export const webhookEntities = sqliteTable(
  'webhook_entities',
  {
    webhookPath: text('webhook_path').notNull(),
    method: text('method').notNull(),
    workflowId: text('workflow_id').notNull(),
    node: text('node').notNull(),
  },
  (t) => [primaryKey({ columns: [t.webhookPath, t.method] })],
);

// 轮询去重（processed data）：记录某工作流某上下文（节点）已见过的键，只放行新键。
// 工作流标签：项目维度，名字项目内唯一（服务层校验）。
export const tags = sqliteTable(
  'tags',
  {
    id: uuidPk('id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('tags_project_idx').on(t.projectId)],
);

export const workflowTagMappings = sqliteTable(
  'workflow_tag_mappings',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.tagId] })],
);

// 工作流运行统计：执行收尾累加（生产=非 manual）。执行历史可清理，统计不受影响。
export const workflowStatistics = sqliteTable('workflow_statistics', {
  workflowId: text('workflow_id').primaryKey(),
  productionSuccess: integer('production_success').notNull().default(0),
  productionError: integer('production_error').notNull().default(0),
  manualRuns: integer('manual_runs').notNull().default(0),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
});

export const processedData = sqliteTable(
  'processed_data',
  {
    workflowId: text('workflow_id').notNull(),
    contextKey: text('context_key').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.contextKey, t.value] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  loadOnStartup: integer('load_on_startup', { mode: 'boolean' }).notNull().default(false),
});

// 每 project 的配额配置（docs/08）。无行 = unlimited（自托管友好）。
export const projectQuotas = sqliteTable('project_quotas', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  plan: text('plan').notNull(),
  monthlyExecutions: integer('monthly_executions'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 支付订单（支付宝订单式购买；out_trade_no = id）
/* Chat 会话/个人 Agent（backlog #14,用户维度非项目维度;messages 随会话行 JSON 存） */
export const chatAgents = sqliteTable(
  'chat_agents',
  {
    id: uuidPk('id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    system: text('system').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('chat_agents_user_id_idx').on(t.userId)],
);

export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: uuidPk('id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull().default('New chat'),
    /** 会话目标（模型/个人 agent/工作流 agent）,前端 ChatTarget 形状原样 JSON。 */
    target: text('target', { mode: 'json' }).$type<JsonObject>(),
    wfSessionId: text('wf_session_id'),
    /** 消息数组（{role, content, workflow?, error?}[]）,聊天规模下整列重写可接受。 */
    messages: text('messages', { mode: 'json' }).$type<JsonObject[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('chat_sessions_user_id_idx').on(t.userId)],
);

/** 自定义项目角色（backlog #29）：命名的权限集,name 全实例唯一。 */
export const customRoles = sqliteTable('custom_roles', {
  id: uuidPk('id'),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const billingOrders = sqliteTable('billing_orders', {
  id: uuidPk('id'),
  projectId: text('project_id').notNull(),
  plan: text('plan').notNull(),
  months: integer('months').notNull(),
  amount: text('amount').notNull(),
  status: text('status').notNull().default('pending'),
  externalRef: text('external_ref'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer('paid_at', { mode: 'timestamp' }),
});

// 用量计数（docs/08）：billing-ready，独立于 executions。
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    projectId: text('project_id').notNull(),
    period: text('period').notNull(),
    executions: integer('executions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.period] })],
);

// 审计日志（docs/06）：只追加。details 绝不含凭证明文/密文（铁律 3）。
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: uuidPk('id'),
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    userId: text('user_id'),
    projectId: text('project_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: text('details', { mode: 'json' }).$type<JsonObject>(),
    ip: text('ip'),
  },
  (t) => [index('audit_logs_project_id_timestamp_idx').on(t.projectId, t.timestamp)],
);

/** 评测测试运行（backlog #31）：对某工作流用数据集跑一轮评测。归属沿用 workflow。 */
export const testRuns = sqliteTable(
  'test_runs',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id').notNull(),
    dataTableId: text('data_table_id'), // 数据集来源（null = trigger 未绑定，跑空）
    triggerNode: text('trigger_node').notNull(),
    status: text('status').notNull().default('running'), // running|completed|error|canceled
    totalCases: integer('total_cases').notNull().default(0),
    ranCases: integer('ran_cases').notNull().default(0),
    passedCases: integer('passed_cases'), // null = 无 pass/fail 判定
    metrics: text('metrics', { mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .$defaultFn(() => ({})), // 聚合指标（各指标行均值）
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (t) => [index('test_runs_workflow_id_created_at_idx').on(t.workflowId, t.createdAt)],
);

/** 评测单用例结果（backlog #31）：数据集每行一条,链到实际 execution。 */
export const testCaseRuns = sqliteTable(
  'test_case_runs',
  {
    id: uuidPk('id'),
    testRunId: text('test_run_id')
      .notNull()
      .references(() => testRuns.id),
    executionId: text('execution_id'), // 该行触发的执行（null = 执行建立前就失败）
    rowIndex: integer('row_index').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().$defaultFn(() => ({})),
    metrics: text('metrics', { mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .$defaultFn(() => ({})),
    status: text('status').notNull(), // success|error
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('test_case_runs_test_run_id_idx').on(t.testRunId)],
);

/** SSO 角色映射规则（backlog #42）：把 SSO 声明/LDAP group 映射到项目角色,ordering 定优先级。 */
export const roleMappingRule = sqliteTable('role_mapping_rule', {
  id: uuidPk('id'),
  sourceType: text('source_type').notNull(), // 'ldap-group' | 'oidc-claim' | 'saml-attr'
  matchKey: text('match_key').notNull().default(''), // claim/attr 名（ldap-group 用 memberOf 属性,可留空）
  matchValue: text('match_value').notNull(), // 期望匹配的 group DN / 声明值
  projectRole: text('project_role').notNull(), // project:viewer|editor|owner
  ordering: integer('ordering').notNull().default(0), // 优先级：大者优先（同项目多规则命中取最高）
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 规则 → 项目 多对多（backlog #42）：一条规则可授权多个项目的成员资格。 */
export const roleMappingRuleProject = sqliteTable(
  'role_mapping_rule_project',
  {
    ruleId: text('rule_id')
      .notNull()
      .references(() => roleMappingRule.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.projectId] })],
);

/** 发布/回滚事件史（backlog #40）：每次 publish/rollback 一条,可回看。 */
export const workflowPublishHistory = sqliteTable(
  'workflow_publish_history',
  {
    id: uuidPk('id'),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    versionId: text('version_id').notNull(), // 发布/回滚到的版本
    action: text('action').notNull(), // 'publish' | 'rollback'
    userId: text('user_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('workflow_publish_history_workflow_idx').on(t.workflowId, t.createdAt)],
);

/** 逐触发器激活状态（backlog #40）：激活时一节点一条,失败带 error 供 UI 展示。 */
export const publicationTriggerStatus = sqliteTable(
  'publication_trigger_status',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    nodeName: text('node_name').notNull(),
    triggerType: text('trigger_type').notNull(), // webhook|schedule|poll
    status: text('status').notNull(), // active|error
    error: text('error'),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.nodeName] })],
);

/** 凭证引用索引（backlog #40）：工作流保存时重建,删凭证前查引用方。 */
export const credentialDependency = sqliteTable(
  'credential_dependency',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id),
    credentialId: text('credential_id').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.credentialId] }),
    index('credential_dependency_cred_idx').on(t.credentialId),
  ],
);

/**
 * Insights 原始事件（backlog #39）：执行收尾写一条,与 executions 保留期解耦——
 * 执行历史被清理后 Insights 数字不变。卷积后可按 rollupAt 剪旧行。
 */
export const insightsRaw = sqliteTable(
  'insights_raw',
  {
    id: uuidPk('id'),
    executionId: text('execution_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    projectId: text('project_id').notNull(),
    status: text('status').notNull(), // success|error|canceled|...
    runtimeMs: integer('runtime_ms'), // stoppedAt-startedAt,null=未知
    at: integer('at', { mode: 'timestamp_ms' }).notNull(), // 收尾时刻
    rolledUp: integer('rolled_up', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('insights_raw_project_at_idx').on(t.projectId, t.at)],
);

/** Insights 日粒度卷积（backlog #39）：insights_raw → 项目×日聚合,长期留存。 */
export const insightsByPeriod = sqliteTable(
  'insights_by_period',
  {
    projectId: text('project_id').notNull(),
    period: text('period').notNull(), // 'YYYY-MM-DD'（UTC 日）
    total: integer('total').notNull().default(0),
    success: integer('success').notNull().default(0),
    error: integer('error').notNull().default(0),
    runtimeSum: integer('runtime_sum').notNull().default(0),
    runtimeCount: integer('runtime_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.period] })],
);

/** Insights 元数据快照（backlog #39）：工作流/项目名冻结,删源后仍可展示。 */
export const insightsMetadata = sqliteTable('insights_metadata', {
  workflowId: text('workflow_id').primaryKey(),
  workflowName: text('workflow_name').notNull(),
  projectId: text('project_id').notNull(),
  projectName: text('project_name').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * DB 调度器 · 作业定义（backlog #38 地基项）：统一定时任务落库,重启不丢。
 * kind 可扩展：workflow-schedule / ldap-sync / insights-rollup / agent-task。
 */
export const scheduledJobs = sqliteTable(
  'scheduled_jobs',
  {
    id: uuidPk('id'),
    kind: text('kind').notNull(),
    workflowId: text('workflow_id'), // workflow-schedule 用
    nodeName: text('node_name'), // 哪个 Schedule Trigger 节点
    config: text('config', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .$defaultFn(() => ({})), // { mode:'cron'|'interval'|'once', cron?, everySeconds?, fireAt? }
    timezone: text('timezone').notNull().default('UTC'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    nextRunAt: integer('next_run_at', { mode: 'timestamp_ms' }), // null = 不再触发（once 已触发/停用）
    maxAttempts: integer('max_attempts').notNull().default(1),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('scheduled_jobs_active_next_run_idx').on(t.active, t.nextRunAt)],
);

/**
 * DB 调度器 · 到期触发实例（backlog #38）：一次到期一条,租约抢占保证多实例只触发一次。
 * unique(jobId, scheduledFor)：同一作业同一时刻只物化一条 → 天然去重。
 */
export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: uuidPk('id'),
    jobId: text('job_id')
      .notNull()
      .references(() => scheduledJobs.id),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
    status: text('status').notNull().default('pending'), // pending|running|done|error
    attempts: integer('attempts').notNull().default(0),
    claimedBy: text('claimed_by'), // 抢到租约的实例 id
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    leaseEpoch: integer('lease_epoch').notNull().default(0), // 乐观锁：claim 时 +1
    executionId: text('execution_id'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('scheduled_tasks_job_time_uic').on(t.jobId, t.scheduledFor),
    index('scheduled_tasks_status_idx').on(t.status, t.leaseExpiresAt),
  ],
);

/**
 * 外部身份绑定（backlog #36）：user ↔ (providerType, providerId)。
 * SSO/LDAP 登录优先按此绑定认归属——email 变更或多 provider 并存不再错认。
 */
export const authIdentities = sqliteTable(
  'auth_identities',
  {
    id: uuidPk('id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    providerType: text('provider_type').notNull(), // 'oidc' | 'saml' | 'ldap'
    providerId: text('provider_id').notNull(), // IdP sub / SAML nameID / LDAP 稳定 id
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('auth_identities_provider_uic').on(t.providerType, t.providerId)],
);

/** 认证 provider 同步历史（backlog #36）：每次 LDAP 同步记 scanned/created/updated/disabled 与错误。 */
export const authProviderSyncHistory = sqliteTable('auth_provider_sync_history', {
  id: uuidPk('id'),
  providerType: text('provider_type').notNull(),
  status: text('status').notNull(), // 'success' | 'error'
  scanned: integer('scanned').notNull().default(0),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  disabled: integer('disabled').notNull().default(0),
  error: text('error'),
  runAt: integer('run_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 登出令牌黑名单（backlog #37）：登出即拉黑该 JWT 哈希,到期后清理。 */
export const invalidAuthTokens = sqliteTable('invalid_auth_tokens', {
  tokenHash: text('token_hash').primaryKey(), // sha256(JWT)，绝不存明文
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(), // = JWT exp,过期即可清理
});

/** 执行标注（backlog #35）：每次执行一条,👍👎 + 笔记。1:1 于 execution。 */
export const executionAnnotations = sqliteTable('execution_annotations', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => executions.id),
  vote: text('vote'), // 'up' | 'down' | null
  note: text('note').notNull().default(''),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 标注标签定义（backlog #35）：name 全实例唯一。 */
export const annotationTags = sqliteTable('annotation_tags', {
  id: uuidPk('id'),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 执行↔标注标签 多对多（backlog #35）。 */
export const executionAnnotationTags = sqliteTable(
  'execution_annotation_tags',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => executions.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => annotationTags.id),
  },
  (t) => [primaryKey({ columns: [t.executionId, t.tagId] })],
);

/** 执行自定义元数据（backlog #35）：运行中写 KV,执行列表可按键值检索。 */
export const executionMetadata = sqliteTable(
  'execution_metadata',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => executions.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.key] }),
    index('execution_metadata_key_value_idx').on(t.key, t.value),
  ],
);

/** 每用户收藏（backlog #34）：取代 workflows.favorite 全局布尔。resourceType 可扩展。 */
export const userFavorites = sqliteTable(
  'user_favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    resourceType: text('resource_type').notNull(), // 'workflow'（未来可加 credential 等）
    resourceId: text('resource_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resourceType, t.resourceId] })],
);

export const sqliteSchema = {
  users,
  apiKeys,
  passwordResets,
  invitations,
  projects,
  projectRelations,
  workflows,
  workflowVersions,
  installedNodes,
  folders,
  sharedWorkflows,
  credentials,
  sharedCredentials,
  dynamicCredentialResolvers,
  dynamicCredentialEntries,
  variables,
  dataTables,
  dataTableRows,
  executions,
  executionData,
  webhookEntities,
  processedData,
  tags,
  workflowTagMappings,
  workflowStatistics,
  settings,
  auditLogs,
  projectQuotas,
  usageCounters,
  billingOrders,
  customRoles,
  chatAgents,
  chatSessions,
  testRuns,
  testCaseRuns,
  userFavorites,
  executionAnnotations,
  annotationTags,
  executionAnnotationTags,
  executionMetadata,
  invalidAuthTokens,
  authIdentities,
  authProviderSyncHistory,
  scheduledJobs,
  scheduledTasks,
  insightsRaw,
  insightsByPeriod,
  insightsMetadata,
  workflowPublishHistory,
  publicationTriggerStatus,
  credentialDependency,
  roleMappingRule,
  roleMappingRuleProject,
  instanceVersionHistory,
  mcpRegistryServer,
  folderTagMapping,
  agents,
  agentHistory,
  agentThreads,
  agentRuns,
  agentMessages,
  memoryEntries,
  memoryObservations,
  agentTaskDefinitions,
  agentFiles,
  agentChannels,
  workflowBuilderSessions,
  aiBuilderTemporaryWorkflows,
  instanceAiThreads,
  instanceAiMessages,
  instanceAiCheckpoints,
  instanceAiPendingActions,
  instanceAiRunTree,
  instanceAiMemory,
  instanceAiMcpConnections,
};
