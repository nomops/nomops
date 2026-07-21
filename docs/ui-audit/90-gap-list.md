# 90 · 差异与改造清单（gap-list）

> n8n → Nomops 对齐审计的**差异汇总**，供改造阶段逐项处理。
> - 组织：`页面 → 组件 → 差异 → 工作量 S/M/L → 优先级 P0-P2 → 源码参考`。
> - 优先级：**P0** 核心流程/主打场景断裂 · **P1** 主要交互缺失 · **P2** 细节/枝节不一致。
> - 状态：会话 1（阶段一 + 5 核心页）+ 会话 2（Settings 14 子页 + 执行详情 + NDV + Node Creator 细审）。**本清单已把会话 1 的 ⏳ 大部分核实转正/修正**。
> - 红线：源码仅参考交互逻辑，Nomops 自有组件重写；monochrome 配色差异不计 gap。

## 总体判断
Nomops 前端是 n8n 的**高完成度 1:1 复刻**：路由 IA、Overview 五 Tab、画布三段式、NDV 三栏（含 Parameters/Settings + Fixed/Expression 分段 + 参数钉 Focus）、Node Creator 八触发器、凭证/设置弹窗、Settings 15 项菜单 + Personal/Users/API/Community 逐字段——**均已对齐**。真正缺口集中在 **chat-trigger 画布测试闭环** 与 **执行标注/调试** 两簇，外加若干自托管化的简化实现。

---

## P0 —— （已清空）

> **~~P0-1~~ 撤销（误报，2026-07-21 live 复验）**：Agent 画布测试闭环**已存在且可用**。`CanvasView.vue:476` `hasChatTrigger` → 1022 `Open chat` 按钮 + 1086 `Chat` 头 + 1108 `chat-panel` + 1135 `Chat\|Logs` 分栏，`sendChat`→`/api/workflows/:id/chat`。误报根因：审计时截的是「Branch & merge starter」（**无 chat trigger**，正确显示 Logs-only）。在含 chat trigger 的「AI 客服 Agent」上复验，`Open chat`/`Chat` 头/chat-panel 全部渲染（截图 `nomops/canvas-chat-trigger.png`/`canvas-chat-open.png`，面板文案「Send a message to run the workflow from its Chat Trigger.」）。**方法论教训**：单工作流截图会漏掉条件渲染的功能——其余 gap 已按对应条件逐条复验（见下）。

---

## P1 —— 主要交互缺失/不一致

| # | 页面 | 组件 | 差异 | 量 | 源码参考 |
|---|---|---|---|---|---|
| ~~P1-1~~ 撤销 | 画布 | 执行按钮 | **误报（已复验）**：多触发器下拉 + 「from &lt;触发器&gt;」标签**已存在**（`CanvasView.vue:993` `triggerNodes.length>1` → `Execute workflow from {selectedTrigger}` + 997 caret + 1005 「Start from trigger」菜单）。单触发器时显示纯 `Execute workflow`（与 n8n 一致）。审计误报同 P0-1（截了单触发器工作流）。 | — | — |
| ~~P1-2~~ ✅**已修** | NDV | OUTPUT 面板 | ~~缺 Pin data（钉住节点输出）UI~~ | M | `NdvModal.vue` + `DataPane.vue` + `stores/editor.ts` + `CanvasNode.vue` |<br>**已修（2026-07-21）**：引擎/后端/持久化本就齐（`workflow-execute.ts:241` applyPinData、schema/`assertPinTargets`/`pin-data.test.ts` 全有），只缺前端入口。已补：editor store `pinData` 状态 + load/save(自动保存落库) + `pinNodeData/unpinNodeData/isNodeDataPinned/getNodePinData` + 增删改节点同步维护；`DataPane` 加 `head-action` 槽；NDV OUTPUT 头「Pin/Pinned」按钮（钉后展示冻结数据）；画布节点强调色边 + 图钉角标。live 复验：执行→NDV Pin→角标出现→autosave 落库（`{"Seed Data":[{amount:150},…]}`）→刷新仍钉，引擎手动执行用冻结数据。6 个新 store 单测 + 57 前端测试全绿、vue-tsc 无错。 |
| ~~P1-3~~ ✅**已修** | 凭证 | CredentialEdit | ~~缺打开即自动连接测试~~ | S | `CredentialModal.vue` |<br>**已修（2026-07-21）**：结果条(✓/✕/message)本就有，缺的是自动触发。加 `autoTestOnOpen`——编辑态打开即测**已存在凭证**（不 re-save、不 emit、失败静默，手动 Test connection 仍可重试）。live 复验：开 DeepSeek 凭证即显「✓ Connection successful.」。 |
| ~~P1-4~~ ✅已修 | Variables | Overview 变量 Tab | ~~升级墙**写死无条件渲染**（`OverviewView.vue:1272` `v-else-if tab==='variables'` 直出锁态，注释自述「仅前端呈锁态」）——后端 `/api/variables` 已通、Usage 又自称 Enterprise，UI 却永远显示 Community 付费墙。**改造=给锁态加 license 判断**：授权时渲染真正的变量列表/新建行~~ | S | `OverviewView.vue:1272-1282` |<br>**已修（2026-07-21）**：查实变量在 Nomops 是**核心免费功能**（后端路由在 `controllers/index.ts` 非 `ee/routes.ts`，无 license feature key），付费墙是错的 n8n-Community 拟态。已换成真正的 Key/Value/Usage 表格 + 行内新建/编辑/删除（复用已存在的 `.var-table` 样式）。live 复验：empty→add→save(`$vars.KEY`)→delete 全通，57 前端测试全绿，vue-tsc 无错。 |

---

## P2 —— 细节/枝节不一致

| # | 页面 | 组件 | 差异 | 量 | 源码参考 |
|---|---|---|---|---|---|
| ~~P2-1~~ ✅**已修** | 执行 | 详情头 | ~~缺 大小 + 执行 ID 元信息~~ | S | `CanvasView.vue` exec-detail-head |<br>**已修（2026-07-21）**：详情头加「· <大小> · ID <短id>」（大小由运行数据 JSON 的 UTF-8 字节估算、`fmtBytes`；ID 取 UUID 前 8 位）。live 复验：显示「· 530 B · ID 7e927e75」。列表 Exec.ID 仍用短哈希（Nomops 用 UUID 非顺序整数，属主键设计，不改）。 |
| P2-2 | 执行 | 详情操作 | 缺 **Debug in editor**（企业特性，过往执行载入编辑器调试） | M | `/workflow/:id/debug/:execId`（n8n EnterpriseEdition.DebugInEditor） |
| P2-3 | 执行 | 详情操作 | 缺 **执行标注 👍👎 + 评分 tag + 加入评测数据集**（成套，与 Evaluations 锁态一致） | M | `ANNOTATION_TAGS_MANAGER_MODAL` + `ADD_EXECUTION_TO_DATASET_MODAL` |
| ~~P2-4~~ ⊘**不做（复验后收回）** | 凭证 | 字段控件 | ~~凭证字段缺 Fixed/Expression 切换~~ | M | — |<br>**复验（2026-07-21）**：凭证的"表达式"只有 `{{ $secrets.KEY }}`——注入前由 `secrets-service.ts` 物化，**无 `$json`/item 上下文**（凭证在节点执行前解析）。套用节点参数的 `ParamInput`/`ExpressionInput`（面向 `$json` 逐项）会**误导**用户以为支持 item 表达式；且 `$secrets` 现可直接在文本框内联输入、已工作。→ naive 复用不做；真要做需**凭证专属表达式模式**（仅 `$secrets`/env 自动补全），另立独立任务，非小修。 |
| P2-5 | Settings/Environments | Git 配置 | Nomops 委托宿主 Git（Repository URL + Branch），无 n8n 的**应用内 SSH Key 生成/Refresh** + Connection Type 选择 | M | `SettingsView.vue` sourcecontrol 段 |
| P2-6 | Settings/Log Streaming | destination | Nomops webhook-only 内联表单（Name/URL/Signing/2 事件）；n8n 多 destination 类型(webhook/syslog/sentinel) + 卡片 + modal + 细粒度事件树 | L | `SettingsView.vue` logstream 段 |
| P2-7 | Settings/External Secrets | provider | Nomops 仅 env-var provider（`NOMOPS_SECRET_<KEY>`）；n8n 多 vault provider(Vault/AWS/Azure/GCP/Infisical) | L | `SettingsView.vue` secrets 段 |
| P2-8 | 画布 | 顶栏 `⋯` | 菜单项需补齐核对（Settings / Push to git 等），当前 Download/Duplicate/Import/Delete | S | `features/canvas/.../CanvasHeaderMenu` |

> **P2-5/6/7 性质**：多为 Nomops 自托管务实取舍（用宿主 git、env-var secrets、webhook 日志），**功能可用**，非必改；若目标是 100% 对齐 n8n 的 IA/能力面才列改造。

---

## ✅ 已核实一致（原 ⏳ 已清，无需改造）
- **Node Creator**：`What triggers this workflow?` + 8 策展触发器（逐字对齐）。
- **NDV**：三栏 + Parameters/Settings Tab + Fixed/Expression 分段（覆盖 6 类型）+ 参数钉 Focus 面板 + Docs 链接 + Execute step/previous 空态。
- **执行**：列表（Auto refresh/多选/红错行）+ 详情（列表 + 只读画布 + Copy to editor + 「Which executions saving?」）+ 重试两变体（措辞对齐）。
- **Settings 壳 + Personal/Users/API/Community nodes**：菜单项/顺序/徽章 + 逐字段对齐。
- **凭证 modal**：头/三 Tab(Connection/Sharing/Details)/docs 提示/enterprise 提示/密码占位。
- **Overview 五 Tab / KPI 卡 / 侧栏 / 标签编辑器**。

## ⏳ 仍待下一会话（未审页面，非已知 gap）
- **未审页面**：Templates 详情、Projects 详情/设置、Chat(AI 会话)整页、Insights 全维、版本历史整页、Evaluations、认证页(signin/setup/forgot)、Data tables 详情、Nomops 特有 Admin/Audit。
- **全局组件**：命令面板 ⌘K、通知 toast、用户菜单、What's New/About/版本更新面板。
- **Settings 剩余子页逐字段**：SSO/LDAP/Security/OpenTelemetry/Roles(锁态)/MCP/Chat（已截图，未逐字段）。
- **凭证**：Sharing/Details Tab 内容、OAuth「Connect my account」授权流（源码有分支，未跑）。
- **执行**：批量停止条、错误 toast「Problem in node」并排（本次为 success 执行未触发）。

---

## 改造顺序建议
1. **P0-1**（Agent 画布 Chat 测试闭环）——Nomops 核心卖点，最高优先。
2. **P1-3**（凭证连接测试体验）+ **P1-4**（变量门控 bug，纯逻辑修复，量小收益高）。
3. **P1-1 / P1-2**（执行按钮触发器标签、NDV Pin data）。
4. P2 与"待审"项：先补完未审页面的审计，再与用户确认后批量处理。
