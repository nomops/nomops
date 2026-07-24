# 13 — EPIC-AI-BUILDER：AI 生成工作流 + 实例助手（backlog #45 规划文档）

> 状态：**规划**（backlog #45，`XL`，独立立项）。「先规划再动工」的规划产物,非实现。
>
> 对标 n8n 的 ~16 表 AI-builder 体系。nomops 现状：`assistant-service` 能让模型生成
> 可导入的 workflow JSON（chat 的 `wfSessionId` 是会话雏形），但**没有**：多轮建流会话的
> 持久化、临时草稿工作流、带检查点/HITL 的实例助手线程。本 Epic 把「一次性生成」升级为
> **有状态、可回滚、人可中途确认（HITL）的 AI 建流 + 运维助手**。

---

## 一、目标与边界

**两条产品线，共用底座**：
1. **AI 建流会话**：用户用自然语言多轮迭代出一个工作流；每轮产出临时草稿,可预览、可回退、
   满意再落为正式 workflow。
2. **实例助手（instance AI）**：一个能读实例状态、调工具、在关键动作前请人确认（HITL）的
   运维 agent；带线程/检查点/运行树快照,可观察-反思。

**共用底座**：一个**有检查点的 AI 线程**（thread + checkpoint + run-tree），两条线都是它的应用。

**不做**：
- 不重训模型；编排既有 provider（复用 P7 ChatModel）。
- 不与 #44 Agents 平台合并——#44 是「用户定义的持久 agent」,#45 是「系统内建的建流/运维助手」。
  两者可共享记忆/线程的表结构经验,但归属与入口不同（#44 归 project,#45 多为实例级）。

**依赖**：assistant-service（现有）、ChatModel 多 provider（P7）、workflow 校验/导入
（WorkflowService.importFromSync 等）、#40 发布管线（临时流 → 正式流落地时复用版本/发布）。

---

## 二、数据模型（对标 n8n ~16 表 → nomops 归并）

### 组 A — AI 建流会话

| 表 | 关键列 | 说明 |
|---|---|---|
| `workflow_builder_session` | id, userId, projectId, title, goal, status(active/applied/discarded), createdAt, updatedAt | 一次建流会话（多轮迭代的边界）。 |
| `ai_builder_temporary_workflow` | id, sessionId, revision, nodes(json), connections(json), summary, createdAt | 每轮产出的临时草稿。revision 递增 → 可回退到任一轮。满意时其 nodes/connections 落为正式 workflow（走 WorkflowService.create + #40 发布）。 |

> **决策**：临时流**不进 workflows 表**（避免污染列表 + 触发器误激活）;单独表,只在
> 「Apply」时物化为正式 workflow。预览走前端只读画布（已有 ReadOnlyCanvas）。

### 组 B — 有检查点的 AI 线程（实例助手底座）

| 表 | 关键列 | 说明 |
|---|---|---|
| `instance_ai_thread` | id, userId, kind(builder/ops), title, createdAt | 助手线程。 |
| `instance_ai_message` | id, threadId, role, content(json), createdAt | 线程消息（含工具调用/结果 block）。 |
| `instance_ai_checkpoint` | id, threadId, seq, state(json 可序列化), createdAt | 检查点：线程在某步的完整可序列化状态,可回滚/续跑（对齐铁律 4 的思路）。 |
| `instance_ai_run_tree` | id, threadId, parentId?, label, input(json), output(json), status, createdAt | 运行树快照：一次助手动作的调用树（工具→子调用），供「观察」。 |

### 组 C — HITL（人在环）与记忆

| 表 | 关键列 | 说明 |
|---|---|---|
| `instance_ai_pending_action` | id, threadId, action(json: {tool, args, risk}), status(pending/approved/rejected), decidedBy?, decidedAt?, createdAt | 危险动作（删数据/改配置/发消息）挂起等人确认——**复用现有安全边界思路**：外发/不可逆动作先落 pending,UI 里人点确认再执行。 |
| `instance_ai_memory` | id, threadId?, scope, kind(observation/reflection), content, embedding(json), createdAt | 观察-反思记忆：助手从运行里提炼经验（与 #44 memory_entries 同构,可共用 repo 抽象）。 |
| `instance_ai_mcp_connection` | id, threadId?, serverName, url, config(json), status, createdAt | 助手连接的 MCP server（复用 #43 mcp_registry_server 缓存作候选源）。 |

---

## 三、里程碑（分批,各自可验收）

- **M1 — AI 建流会话 + 临时流**（`M/L`）：`workflow_builder_session` +
  `ai_builder_temporary_workflow`；多轮迭代 → 临时草稿 revision 链 → 预览（ReadOnlyCanvas）
  → Apply 落正式 workflow。复用 assistant-service 生成 + workflow 结构校验。
  验收：多轮改流、回退到上一轮、Apply 后成为可运行工作流。
- **M2 — 有检查点的 AI 线程底座**（`L`）：`instance_ai_thread/message/checkpoint`；
  线程可序列化状态落检查点、可回滚续跑。验收：线程中断后从检查点恢复,状态一致。
- **M3 — HITL 待确认**（`M`）：`instance_ai_pending_action`；助手的危险动作先挂 pending,
  UI 确认后才执行（与平台安全边界一致——外发/不可逆先确认）。验收：删/改动作被拦成待确认,拒绝则不执行。
- **M4 — 运行树 + 观察-反思记忆**（`M/L`）：`instance_ai_run_tree` + `instance_ai_memory`
  （可与 #44 memory 共用 embedding 检索）。验收：助手动作有调用树可看;跨线程记住经验。
- **M5 — MCP 连接**（`S/M`）：`instance_ai_mcp_connection`（候选源 = #43 registry 缓存）。
  验收：助手挂一个 MCP server → 其工具进助手工具集。

**总量**：约 XL。M1 单独就是「AI 建流」这条完整产品线,可先只做 M1 交付价值,再叠实例助手（M2–M5）。

---

## 四、关键决策速查

1. **临时流隔离**：AI 草稿单独表,不进 workflows,Apply 时才物化（防列表污染 + 误激活）。
2. **检查点 = 可序列化状态**（铁律 4）：instance_ai_checkpoint 存整段可 JSON.stringify 的线程态,
   与引擎 RunExecutionData 同一哲学。
3. **HITL 沿用安全边界**：危险/不可逆/外发动作先落 pending 等人确认——与平台既有「外发前确认」一致。
4. **记忆/MCP 与 #44 共用抽象**：embedding 检索、MCP 缓存两处可提炼共享 repo/service,避免两个 Epic 各造一套。
5. **provider 中立**：生成/助手都走 ChatModel 多 provider（P7),不绑单一厂商。

---

## 五、风险与前置

- **生成质量依赖 prompt 工程 + 节点 schema 完整度**：assistant-service 的 system prompt 需喂
  最新节点目录(node-catalog-gap 追踪);节点缺口大则生成不可用。
- **HITL 的「危险动作」判定**需要一份动作风险清单——判错会漏拦或过度打扰。
- **检查点体量**：run-tree/checkpoint 可能大,需与执行历史一样有清理策略（复用 pruner 思路）。
- **两个 Epic 的边界**：#44 与 #45 的记忆/线程表结构相近,动工前应先定「共享 vs 各自」,避免重复。
