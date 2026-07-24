# 12 — EPIC-AGENTS：Agents 平台（backlog #44 规划文档）

> 状态：**规划**（backlog #44，`XL`，独立立项）。本文是「先规划再动工」的规划产物，
> 不是实现。动工前应把里程碑 M1 的数据模型与验收再对一遍。
>
> 对标 n8n 的 ~20 表 agent 体系。nomops 现状：仅 `chat_agents` 单表（`name + system`），
> 加画布里的 `AiAgent` 节点（模型/工具/记忆子节点可插拔）。本 Epic 把「一次性对话 agent」
> 升级为**有身份、有版本、有记忆、能定时、能被外部渠道触发**的持久 agent。

---

## 一、目标与边界

**目标**：让用户定义一个 agent（system prompt + 模型 + 工具集 + 记忆策略），发布版本，
被多种入口触发（画布 chat、外部渠道如 Telegram、定时任务），每次运行留下可核算
（token/成本）、可追溯（线程 + 证据链记忆）的记录。

**不做（本 Epic 之外）**：
- 训练/微调模型；只编排既有 provider（复用 P7 的 ChatModel 多 provider 节点）。
- 通用向量数据库；embedding 记忆用现有 DB + 简单相似度，够 MVP（见 M3 决策）。
- #45 的 AI-建流会话（那是另一个 Epic）。

**依赖**：
- **#38 DB 调度器**（已完成）——agent 定时任务直接建 `scheduled_jobs`（kind=`agent-task`），
  无需新调度器。这是本 Epic 能拆小的关键。
- P7 的 `ChatModel` 多 provider 节点 + `AiAgent` 节点的 tool/memory 抽象。
- #35 执行标注 / #39 Insights（agent 运行也走 executions，天然复用）。

---

## 二、数据模型（对标 n8n ~20 表 → nomops 归并）

按 nomops 约定：`uuidPk('id')`、`text(...).references()` FK、JSON 用 `text{mode:json}`/
`jsonb`、时间戳 `timestamp`、双方言 + schema-parity 测。归属：agent 归 **project**
（团队共享），沿用 `shared_*` 或直接 `projectId` 列（与 workflows 一致）。

### 组 A — 定义与版本（替代/扩展 chat_agents）

| 表 | 关键列 | 说明 |
|---|---|---|
| `agents` | id, projectId, name, description, config(json: {model, system, toolIds[], memoryPolicy}), publishedVersionId?, active, createdAt, updatedAt | agent 定义。config 里引用工具/模型,不内联,便于换。 |
| `agent_history` | id, agentId, versionNumber, config(json 快照), createdBy, createdAt | 发布版本史（同 workflow_versions 的模式，直接复用其经验）。 |

> **迁移**：现有 `chat_agents(name, system)` → `agents`（system 进 config，project 归属）。
> 保留 chat_agents 一版做兼容，或一次性搬迁（M1 决定）。

### 组 B — 线程化执行 + 成本核算

| 表 | 关键列 | 说明 |
|---|---|---|
| `agent_threads` | id, agentId, projectId, channel(text: canvas/telegram/task), externalRef?, title, createdAt | 一个会话线程（跨多次运行的上下文边界）。 |
| `agent_runs` | id, threadId, agentId, executionId?, status, inputTokens, outputTokens, costMicros, model, startedAt, endedAt, error? | 一次 agent 运行。**executionId 链到 executions 表**（复用引擎、标注、Insights）。token/成本按 provider 计价累计。 |
| `agent_messages` | id, threadId, runId?, role, content(json), createdAt | 线程内消息（含工具调用/结果 block，多模态复用 #32 的 images）。 |

> **决策**：agent 运行**跑在现有引擎上**——把 agent 的 model/tool/memory 组装成一个
> 内部 workflow（AiAgent 节点 + ChatModel 子节点 + 工具子节点），经 `runTriggered`
> 建 execution。这样成本核算、标注、Insights、执行详情全部免费复用，不另造执行栈。
> agent_runs 只是 executions 的「业务视图 + 成本账」。

### 组 C — 分层记忆（embedding + 证据链）

| 表 | 关键列 | 说明 |
|---|---|---|
| `memory_entries` | id, agentId, threadId?, scope(thread/agent/global), kind(fact/summary/preference), content, embedding(json: number[]), createdAt, lastUsedAt | 记忆条目。scope 定分层：线程级 < agent 级 < 全局。 |
| `memory_observations` | id, entryId, runId, evidence(json), createdAt | 证据链：某条记忆是哪次运行、依据什么观察产生的（可追溯/可撤销）。 |

> **决策（embedding）**：MVP 用 provider 的 embedding API（OpenAI/兼容）算向量存 JSON，
> 检索时在应用层做 cosine 相似度（记忆量小，够用）；不引向量库。相似度 top-k 注入
> AiAgent 的 memory 输入（复用现有 `IAiMemory` 抽象 + WindowMemory 节点的位置）。
> provider embedding 走可注入 fetchImpl（同 STT/Vault 的取舍）。

### 组 D — 定时任务（依赖 #38，已就绪）

| 表 | 关键列 | 说明 |
|---|---|---|
| — | 复用 `scheduled_jobs`(kind=`agent-task`, config 存 agentId + prompt) | **不建新表**。#38 的 SchedulerService fire 按 kind 分派已支持（见 insights-rollup 先例）。 |
| `agent_task_definition` | id, agentId, name, schedule(cron/interval), prompt, active | 仅存「用户可见的任务定义」;激活时 upsert 一条 scheduled_job,停用即 deactivate。 |

> n8n 的 `task_definition + run_lock` 中的 run_lock（防重复执行）在 nomops 里由 #38 的
> **scheduled_tasks 租约乐观锁**天然提供——不需要 run_lock 表。这是 #38 地基项的红利。

### 组 E — 文件与外部渠道

| 表 | 关键列 | 说明 |
|---|---|---|
| `agent_files` | id, agentId, threadId?, binaryId, fileName, mimeType, createdAt | agent 上传/产出的文件,binaryId 复用 #32 的 binaryStore(FileSystem/S3)。 |
| `agent_channels` | id, agentId, type(telegram/slack/…), credentialId, config(json), active, createdAt | 外部渠道订阅。type=telegram 时 config 存 bot 设置;激活即注册 webhook（复用 webhook_entities 路径）。 |

---

## 三、里程碑（分批,各自可验收、单独提交）

- **M1 — Agent 定义 + 版本**（`M`）：`agents` + `agent_history` + 迁移 chat_agents；
  CRUD API + 发布/回滚（照搬 workflow 发布管线 #40 的经验）。前端 agent 编辑页。
  验收：建 agent、发布、回滚、列表；旧 chat_agents 数据迁入不丢。
- **M2 — 线程化执行 + 成本核算**（`M/L`）：`agent_threads/runs/messages`；把 agent 组装成
  内部 workflow 经引擎跑 → execution + agent_run；按 provider 计价累计 token/成本。
  验收：对话触发 agent 运行 → 线程留痕 → 运行详情可看 token/成本 + 跳 execution。
- **M3 — 分层记忆 + 证据链**（`L`）：`memory_entries/observations`；embedding 检索 top-k
  注入 AiAgent memory；证据链可追溯。验收：跨线程记住偏好；每条记忆能查到来源运行。
- **M4 — 定时任务**（`S`，靠 #38）：`agent_task_definition` + upsert scheduled_job(kind
  agent-task) + fire 分派。验收：定时触发 agent、双实例只触发一次（#38 租约已保证）。
- **M5 — 文件 + 外部渠道**（`M`）：`agent_files` + `agent_channels`；Telegram 渠道（bot
  webhook → agent 线程）。验收：Telegram 发消息触发 agent、回复回渠道。

**总量**：M/L 级 5 个里程碑，约 XL。M1–M2 是骨架,M3–M5 是能力叠加,可按价值停在任一里程碑。

---

## 四、关键决策速查

1. **不另造执行栈**：agent 运行 = 内部 workflow 走现有引擎 → 复用 execution/标注/Insights/成本。
2. **不建 run_lock**：#38 scheduled_tasks 租约乐观锁天然防重复。
3. **不引向量库**：embedding 存 JSON + 应用层 cosine top-k，MVP 够用；provider embedding 可注入。
4. **归属走 project**：agent 团队共享,沿用 workflows 的 shared_* / projectId 归属边界（铁律 2）。
5. **凭证明文不出**（铁律 3）：渠道/embedding 的密钥经凭证系统解密即用即弃。
6. **可序列化**（铁律 4）：agent 运行的中间态就是 RunExecutionData,不新增不可序列化状态。

---

## 五、风险与前置

- **成本计价表**需维护各 provider 单价（放 config/常量,可后台改）——不准会误导账单。
- **外部渠道（Telegram）**牵扯公网可达 webhook；自托管需隧道（与「不做 Desktop」同类 ROI 考量）。渠道做成可选,不阻塞 M1–M4。
- **记忆隐私**：memory_entries 可能含敏感对话;需支持按 thread/agent 清除 + 不进日志。
