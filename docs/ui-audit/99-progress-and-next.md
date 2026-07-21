# 99 · 进度摘要 & 下一会话续作指令

## C 轮补审（会话 2 末，未审整页）
产出 `pages/secondary-pages.md`。结论：**次级页也基本对齐**。
- **强复刻**：Chat、Insights、版本历史、认证页、命令面板（Nomops palette 覆盖 Workflows/Credentials/Data tables，实际比 n8n 更"列资源"）。
- **刻意设计分歧（非 gap）**：Templates（Nomops 自托管本地库 4 模板 vs n8n 外部网站）。
- **Nomops 增项**：Projects 独立管理页（配额+成员）、Admin、Audit——无 n8n 对应。
- **C-1（Chat 附件/语音）** ⊘ 复验后收回：Nomops 无附件/STT 基建，加空按钮=P2-4 式误导，真做需多模态+STT（非小修）。chat 属刻意纯文本设计。
- 剩余细项 ⏳：Evaluations 锁态、Data table 详情、认证 SSO 入口、Admin/Audit 字段级。
- C 轮审计文档**未提交**（`docs/ui-audit/` 的 secondary-pages.md + 00/90 更新）。

## 改造阶段进展（会话 2 后半，用户逐项确认后进行）
- **P1-4 变量墙** ✅ 修完：查实变量在 Nomops 是核心免费功能，付费墙是错的，换成真表格（`OverviewView.vue`）。live 复验通过。
- **P0-1 Agent Chat 闭环** ❌ 误报撤销：功能早已存在（截错工作流所致）。
- **P1-1 执行按钮 from/下拉** ❌ 误报撤销：`triggerNodes>1` 时已有。
- **P1-2 NDV Pin data** ✅ 修完：引擎/后端本就支持，补齐前端（editor store pinData + NDV OUTPUT Pin 按钮 + 节点角标 + autosave 落库 + 6 单测）。live 复验通过。
- **P1-3 凭证自动测连接** ✅ 修完：结果条本就有，加 `autoTestOnOpen`（编辑态开即测已存在凭证，不 re-save）。live 复验通过。
- **P2-1 执行头元信息** ✅ 修完：详情头加「· 大小 · ID 短id」（`CanvasView.vue`）。live 复验通过。
- **P2-4 凭证字段表达式** ⊘ 复验后不做：credentials 只支持 `$secrets`（注入前解析、无 item 上下文），套节点参数的 Fixed/Expression 会误导；`$secrets` 现可内联输入已工作。真要做需凭证专属表达式模式，另立任务。
- **方法论教训**：单工作流截图漏条件渲染功能，导致 2 个误报（P0-1/P1-1）。后续 gap 落地前务必按对应条件（单/多触发器、chat、执行态）live 复验。
- **分支**：`fix/ui-align-variables-pindata`（从 main 拉）。已 commit P1-4/P1-2/审计文档；P1-3/P2-1 待 commit。未 push、未合 main。

## 本会话完成（会话 2 —— 续审）
在会话 1 基础上，把大部分 ⏳ 项核实转正/修正：
- **Settings 14 子页双侧并排**：Personal/Users/API/Community=逐字段一致；Environments/Log Streaming/External Secrets=Nomops 自托管化简化实现（gap P2-5/6/7）；发现本地 n8n license **部分授权**（Log Streaming 显 paywall，Variables 已解锁）。
- **执行详情并排**：Nomops 有列表+只读画布+Copy to editor+重试两变体+「Which executions saving?」；**缺** Debug in editor / 标注👍👎 / 头部 大小·ID 元信息（gap P2-1/2/3）。
- **NDV/Node Creator 核实**：Fixed/Expression 分段控件**已有**（修正会话 1 误判）、参数钉 Focus **已有**、8 触发器 Node Creator **已有**；**缺** Pin data 钉节点输出（gap P1-2）。
- `90-gap-list.md` 已重排：P0×1 / P1×4 / P2×8 + 「已核实一致」清单。

## 本会话完成（会话 1）

### 阶段一 ✅ —— `00-inventory.md`
- 从 n8n 源码（`app/router.ts` + `projects.routes.ts` + 7 个 `module.descriptor.ts` + `Modals.vue`）提取**全部路由**（认证/首页/画布/模板/Insights/设置 24 子页/错误页）与**~60 个弹窗**注册表。
- 运行实例 n8n **2.30.4**（源码 2.31.0）逐路由**浏览器取证截图**（`screenshots/n8n/` 28 张 + 交互 4 张）。

### 阶段二 ✅ —— 5 个核心页深审（`pages/*.md`）
1. `canvas-editor.md`（P0 画布/NDV/Logs）
2. `overview-workflows.md`（P1 Overview 五 Tab）
3. `executions.md`（P0 执行列表+详情）
4. `credentials.md`（P0 凭证列表/类型选择/编辑弹窗）
5. `settings-shell.md`（P1 设置壳 + Usage 子页）
- Nomops 侧全部并排截图（`screenshots/nomops/` 16 张 + NDV/凭证弹窗）。

### 阶段四（初稿）✅ —— `90-gap-list.md`
核心结论：**Nomops 是 n8n 的高完成度 1:1 复刻**，结构层面基本对齐。已定稿 gap：P0×2（画布执行「from 触发器」标签+下拉、Open chat/Chat 面板）、P1×3、P2×2。另有一批 ⏳ 待并排细审。

---

## ⚙️ 取证方法（关键——每会话复用，不要重新摸索）

**n8n 实例需登录，Playwright 新浏览器无会话。已用「注入会话」方案打通**（用户已授权用登录态）：

### n8n（Docker，`localhost:5678`）—— 注入 httpOnly cookie
1. `docker cp n8n:/home/node/.n8n/database.sqlite* <scratch>/`（**必须连 -wal/-shm 一起 copy**，否则读到过期值——本会话踩坑：owner email 已从 `owner@nomops.test` 改为 `guowangkun@outlook.com`）。
2. 读 `deployment_key` 表 `signing.jwt` = JWT 密钥；读 `user` 表 `id/email/password`。
3. 铸 `n8n-auth` cookie（HS256）：payload `{ id, hash, usedMfa:false, iat, exp }`；`hash = sha256([email,password].join(':')).base64.substring(0,10)`（mfaEnabled=false 时）；**省略 browserId 即绕过 browserId 校验**。
4. 验证：`curl --cookie "n8n-auth=<jwt>" localhost:5678/rest/login` 应返回 owner。
5. Playwright `storage_state` 注入 cookie（`secure:false`，因走 http://localhost）。
- 源码依据：`packages/cli/src/services/jwt.service.ts`、`packages/cli/src/auth/auth.service.ts`（`issueJWT`/`createJWTHash`）。

### Nomops（`localhost:5680` API，`5173` vite）—— 注入 localStorage Bearer
1. 读 `packages/server/nomops.db`：`settings.jwtSecret` + `users.id`(owner) + owner 的 personal `project_relations.project_id`。
2. 铸 token（HS256）payload `{ sub, projectId, iat, exp }`。
3. Playwright `storage_state` 的 `origins` 注入 `localStorage: nomops.token` + `nomops.email`（origin=`http://localhost:5173`）。
- 源码依据：`packages/server/src/auth/auth-service.ts`（`issueToken`）、`bootstrap.ts`（`jwtSecret` 存 settings 表）。

### 复用脚本（scratchpad，非仓库；每会话在 scratch 重建）
- `capture.py <base> <outdir> <routes_json> [viewport|full] [state.json]` —— 批量路由截图（记录重定向）。
- `mint.cjs` / `mint-nomops.cjs` —— 纯 Node crypto 铸 JWT（jsonwebtoken 未 hoist，手写 HS256）。
- Playwright 用 `channel="chrome"`（系统 Chrome，无需等 bundled chromium 下载）。venv 在 scratchpad。
- **macOS 无 `timeout` 命令**；批量截图 >20 条会超 2min 前台限制——用 `run_in_background`。canvas 页永不 networkidle（websocket），脚本已用 8s try/except 兜底。

---

## 📋 下一会话续作指令（按此顺序）

### 续 1：Settings 剩余子页逐字段（已截图，未逐字段展开）
SSO / LDAP / Security & policies / OpenTelemetry / Roles(锁态) / MCP / Chat —— 两侧截图都在 `screenshots/{n8n,nomops}/settings-*.png`，只需逐字段并排写入 `settings-shell.md`。

### 续 2：阶段二未审页面（新增 `pages/*.md`）
Templates 详情、Projects 详情/设置、Chat(AI 会话)整页、Insights 全维、版本历史整页、Evaluations、认证页(signin/setup/forgot)、Data tables 详情；Nomops 特有页 Admin/Audit。
全局组件：命令面板 ⌘K、通知 toast、用户菜单、What's New/About/版本更新面板。
遗留小项：凭证 Sharing/Details Tab + OAuth 授权流；执行批量停止条 + 错误 toast「Problem in node」（需故意跑一个失败执行触发）。

### 续 3：定稿 & 改造
- 补全后重排 `90-gap-list.md`，与用户确认清单 → 进**改造阶段**（逐项，不跳）。
- 改造顺序建议见 gap-list 末尾（先 P0 画布 Agent 测试闭环）。

### 环境自检（每会话开头）
- n8n：`curl -s -o /dev/null -w "%{http_code}" localhost:5678`（Docker 容器名 `n8n`，2.30.4）。
- Nomops：`pnpm dev` 起 5173(前端)/5680(server)；`curl localhost:5680/healthz`。
- 截图目录：`docs/ui-audit/screenshots/{n8n,nomops}/`。

### 已知踩坑
- n8n DB 必须连 WAL 一起 copy（否则读到过期 owner/secret）。
- Nomops 有多个 DB（`nomops.db` 活跃 / `nomops-ent.db`）+ 多个 Personal project（`ui-verify-*` 是测试账号，别用错）。owner personal project = `1d0f49fc-58d3-4915-b7ca-5a2f72619cb7`。
