# 页面审计 · 次级页面与全局组件（C 轮补审）

> 用修正后的方法（按对应条件/登录态 live 复验）补审阶段二未覆盖的整页 + 全局组件。
> 截图：`screenshots/{n8n,nomops}/`（chat/insights/templates/projects/workflow-history/auth-*/command-palette 等）。

## 1. Chat（AI 会话整页）
- 路由：n8n `/home/chat`（+ `/:id` `/workflow-agents` `/personal-agents`）；Nomops `/chat`（`ChatView.vue`）
- **强复刻** ✅：左栏 New chat / Personal agents / Workflow agents；顶「Select model」下拉；空态「Select a model to start chatting」；底部「Please select a model…」紫条 + 输入框 + `+ Tools` + 发送。
- **差异**：n8n chat 输入栏有 **附件(📎) + 语音(🎤)** 按钮；Nomops 只有 `+Tools` + 发送（`ChatView.vue:511` 无 attach/mic）。~~gap C-1~~ **复验后收回**：附件/语音在 Nomops 无任何后端/基建（chat 流不支持附件、全库无 STT），加空按钮会误导；真做需多模态+STT，远超 P2。Nomops chat 属刻意纯文本设计。见 `90-gap-list.md` C-1。

## 2. Templates（模板）
- 路由：n8n `/templates`（无自定义 host 时 `window.location.href` 跳 **n8n.io 外部网站**）；Nomops `/templates`（`TemplatesView.vue`）
- **设计分歧（非 gap）**：Nomops 是**自托管本地模板库**（4 个策展模板：New order notification / Daily metrics report / AI content summary / Branch & merge starter，含分类 All/Sales/IT Ops/AI/Advanced + 搜索 + 节点标签 + setup 步骤 + Use template）。n8n 依赖外部网站。Nomops 自托管优先、零外部依赖，**是刻意取舍**。

## 3. Projects（项目）
- 路由：n8n `/projects` → **重定向到 Overview**（无独立项目列表页，项目在侧栏 + 各自 Overview）；Nomops `/projects`（`ProjectsView.vue`）
- **Nomops 增项（无 n8n 对应）**：独立**项目管理页**——表格 Name / Type(personal/team) / My role / **Executions this month（配额，如 35/10000、0/unlimited）** / Manage members + `+ New project`。契合 Nomops 自有配额/计费模型。**记录为增强，非 gap**。

## 4. Insights
- 路由：n8n `/insights/:type?`（模块）；Nomops `/insights/:metric?`（`InsightsView.vue`）
- **强复刻** ✅：filters（All projects + 日期范围）；5 KPI 卡（Prod./Failed/Failure rate/Time saved/Run time，均 Last 7 days）；「Breakdown by day」图（Successful/Failed）；「Breakdown by workflow」表。一致。

## 5. Version History（版本历史整页）
- 路由：n8n `/workflow/:id/history/:versionId?`；Nomops 同（`WorkflowHistoryView.vue`）
- **强复刻** ✅：只读斜纹画布（选中版本）+ 右栏「Versions / Publish Timeline」Tab + 「Current changes」+ N VERSIONS 列表（名/id/时间）+ `Actions` 下拉 + 底部「Version history is limited to 1 day — Upgrade plan to activate full history」保留期门控。一致。

## 6. 认证页（signin / forgot / signup）
- 路由：n8n `/signin` `/forgot-password` `/signup`；Nomops `/login` `/signup`（`LoginView.vue`/`SignupView.vue`）
- **强复刻** ✅：nomops logo + 「Sign in」卡 + Email/Password + Sign in（橙）+ 「Forgot my password」。与 n8n signin 结构一致。
- 待补细看：SSO 登录按钮（n8n SAML/OIDC 启用时 signin 显 SSO 入口）在 Nomops 的呈现（`SsoDoneView` 已有落地页）。⏳

## 7. 命令面板（⌘K）
- **强复刻** ✅：n8n 与 Nomops 均 ⌘K 唤起，「Type a command or search…」+ esc + 分组。
- **覆盖对齐**：Nomops（`CommandPalette.vue`）分组 Workflows（Create + 实例列表）/ Credentials（Create + 列表）/ Data tables（Create + 列表）+ 上下文命令。n8n 是 Workflows/Projects/Credentials/Data Tables 的通用动词（Create/Open）。Nomops 直接列资源实例（体感更快）。**功能对齐**，仅 n8n 多「Create project」动词（Nomops 无）——极小。

## 8. Nomops 特有页（无 n8n 对应，记录为增项）
- **Admin**（`/admin`，AdminView）：运维/管理台（Nomops 自托管管理）。
- **Audit**（`/audit`，AuditView）：审计日志页（对应 n8n 的 auditLogs 企业特性，但 Nomops 做成独立整页）。
- 二者是 Nomops 面向自托管运维的增强，下一轮可细看字段级。⏳

## 9. Evaluations（画布 Evaluations Tab）
- Nomops：`CanvasView.vue:972` 「Register to enable evaluation / Register instance」**Community 锁态占位**，**零后端**（无 dataset/testrun/metric/annotation）。
- n8n 本地实例：**已解锁**，显完整 setup 向导（1 Wire up test dataset + Add evaluation trigger → 2 Write outputs back → 3 quality score → 4 Run in editor）。
- **结论**：整套评测/测试子系统在 Nomops 是 greenfield（见 gap-list **EPIC-EVAL**）。Debug in editor（原 P2-2）、执行标注/数据集（原 P2-3）都属这套，一并归入 epic。**非对齐小修**。

## 差异小结（进 gap-list）
- **C-1**（P2）：Chat 输入栏缺 附件 + 语音按钮。
- 其余：Templates（自托管本地库）、Projects（独立管理页）为**刻意设计分歧/增强**，非 gap。
- 待细看：认证页 SSO 入口、Admin/Audit 字段级、Data table 详情、Evaluations（社区锁态）。
