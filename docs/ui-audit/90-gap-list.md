# 90 · 差异与改造清单（gap-list）

> n8n → Nomops 对齐审计的**差异汇总**，供改造阶段逐项处理。
> - 组织：`页面 → 组件 → 差异 → 工作量 S/M/L → 优先级 P0-P2 → 源码参考`。
> - 优先级：**P0** 核心流程/主打场景断裂 · **P1** 主要交互缺失 · **P2** 细节/枝节不一致。
> - 状态：会话 1（阶段一 + 5 核心页）+ 会话 2（Settings 14 子页 + 执行详情 + NDV + Node Creator 细审）。**本清单已把会话 1 的 ⏳ 大部分核实转正/修正**。
> - 红线：源码仅参考交互逻辑，Nomops 自有组件重写；monochrome 配色差异不计 gap。

## 总体判断
Nomops 前端是 n8n 的**高完成度 1:1 复刻**：路由 IA、Overview 五 Tab、画布三段式、NDV 三栏（含 Parameters/Settings + Fixed/Expression 分段 + 参数钉 Focus）、Node Creator 九触发器、凭证/设置弹窗、Settings 15 项菜单 + Personal/Users/API/Community 逐字段——**均已对齐**。真正缺口集中在 **chat-trigger 画布测试闭环** 与 **执行标注/调试** 两簇，外加若干自托管化的简化实现。

### 2026-08-10 节点级复核（第二批）

- 已对齐：Manual Trigger、Schedule Trigger、Webhook、HTTP Request、Edit Fields、IF、Switch、Code 的 NDV 三栏空态、字段名/顺序、条件显隐、Options/Add Option 和关键组合控件。
- 已补运行时：Schedule Trigger Rules 归一化（兼容旧参数）、HTTP Query/Auth/Body/Binary、Edit Fields Manual/JSON/Include Others/Dot Notation、IF 类型转换、Switch Rules/Expression/Options、Code `$input` + per-item。
- 第二批当时仍待：Webhook `/webhook-test` 短期监听与超时注销；Schedule 同节点多 Rule 的 DB 调度；HTTP Request Import cURL；Code Python 安全沙箱。以上四项已在第三批完成。

### 2026-08-11 节点级复核（第三批）

- Webhook：补齐认证态启动/停止测试监听、公开 `/webhook-test/*` 一次性接收、超时注销、使用当前草稿执行，以及 n8n 形态的 `headers/params/query/body/webhookUrl/executionMode=test` 输出。浏览器真实 GET 首次 200 并回填 1 item，第二次 404，验证一次性消费。
- Schedule Trigger：同一节点的每条 Trigger Rule 分别持久化为 DB scheduler job；更新时复用对应 job 并停用多余旧规则。集成测试验证两条规则分别到期触发。
- HTTP Request：补齐 n8n `Import cURL` modal 和单次 undo 的整组参数替换；支持 HTTP(S) URL、method、query、headers、basic auth，以及 JSON/form/raw data。对照 n8n 的 POST 示例实测还原 URL、`limit=5`、Authorization 和 JSON body。
- Code：补齐 Python 的 all-items/per-item 两种运行模式和受限子进程沙箱（CPU/内存/文件/超时/输出上限，禁 import、文件、网络入口和动态执行）；NDV 显示 Language=Python、行号编辑器与警告提示。当前本地 n8n 对照版本的 Code 节点没有 Ask AI 控件，因此删除 Nomops 先前的禁用假标签，不把不存在的控件计为 gap。
- 验证：生产构建 6/6、全量 1173 项测试通过；隔离实例完成 Webhook、Schedule、HTTP cURL、Python NDV 的同视口浏览器复验，交互期间未出现页面报错。
- 仍需明确的边界：测试 Webhook listener 当前为单进程内存态，多 main/负载均衡部署需要共享 registry 或 sticky routing；cURL importer 不覆盖 multipart 文件、客户端证书、代理等冷门 flag；Python 为安全的自托管子集，不等同 n8n task-runner 的任意包环境。

### 2026-08-11 节点级复核（第四、五批）

- 已对齐参数面：Merge、Loop Over Items、Wait、Execute Workflow、Respond to Webhook、Form/Form Trigger 均按本地 n8n 的主模式、字段顺序、条件显隐和 Options 结构声明，继续复用统一 Input / Parameters|Settings / Output 三栏。
- 已补运行时：Merge matching/position/all/choose-branch，Loop reset，Wait specified-time 与有限期外部等待，Execute Workflow resource locator + per-item，Respond all-items/binary/JWT/redirect/headers，Form Ending 与扩展表单元素；旧 `combineByPosition`、`afterDelay`、`onSignal`、字符串 workflowId 和旧 `fields` 继续可执行。
- 浏览器验收：新工作流先显示触发器策展页；选择 Manual Trigger 后才出现普通节点；Merge 切 Combine 即出现 Fields to Match/Join/Output Data From；Wait 切 On Webhook Call 即出现 Authentication/HTTP Method/Response Code/Respond/Limit Wait Time；三栏结构和空态正常。
- 第五批已关闭三条运行时缺口：Merge SQL Query 在固定堆/超时的无网络无文件 AlaSQL isolate 中执行；Execute Workflow Define Below 经节点类型/连接结构校验后内联执行，不持久化且不放松项目凭证/递归边界；Form File 通过有界 multipart parser 写入现有 binary store，同时产出 `{ filename, mimetype, size }` JSON 元数据。
- 第六批已对齐 Filter、Split Out、Aggregate、Sort、Limit、Remove Duplicates：Filter 运行结果区分 Kept/Discarded，Remove Duplicates 当前输入模式只返回 Kept、跨执行模式返回 Kept/Discarded；Split/Aggregate 补多字段、字段筛选与 binary；Sort 补 Random 和有界隔离 Code；Remove Duplicates 的 value/increment/date 历史按 node/workflow staticData 跨执行持久化并可清理。参数显示仍完全由 schema 的 displayOptions 驱动，collection 子字段支持 `/root` 条件。
- 执行可视化已由全连接广播改为鉴权后的 workflow 频道：服务端同时使用 WebSocket ping/pong 与应用 heartbeat，前端按 workflowId/executionId 双层过滤，静默 35 秒主动断开并以指数退避重连，重连后拉取当前执行详情修正漏掉的终态；并发工作流不再互相覆盖画布高亮。
- 参数显隐已支持 n8n `_cnd` 全部条件操作符和 `@version`：NDV 参数、嵌套 collection/fixedCollection 与凭证槽共享同一判断器，读取节点保存的 typeVersion；表达式控制值按不确定处理而保守显示，版本条件仍优先。Remove Duplicates v1/v2 共用运行实现但呈现各自参数面，存量 v1 可继续加载。
- 表达式运行时已对齐 DateTime 与首批高频扩展：`$now/$today` 支持 `plus/minus/startOf/endOf/toISO/toFormat`，字符串/数组/对象/数字方法通过 AST 改写进入沙箱，不污染原型；共享 `.doc` 元数据同时驱动 NDV 方法补全。Result 预览使用最近 runData 解析真实 `$json/$node`，显示 pending/success/error 三态。
- Agent 工具循环已升级为 V3 引擎请求：真实 Tool 节点逐调用进入执行栈和 runData，继承 retry/AbortSignal；Require Human Approval 复用 waiting/resume，可批准或拒绝。执行详情不再只显示同名节点最后一次运行，而会逐 call 展示 tool name、call id、耗时与 observation。
- 删除与模板首跑链路已闭环：单入单出 main 中间节点删除后自动桥接；模板声明凭证分组并进入 setup 向导，候选无歧义才自动选中，服务端复核项目/类型；Overview 根目录空态提供免凭证 `branch-merge-demo` starter。隔离实例验证 starter 6 节点成功、AI 向导绑定 Chat Model、删除后 `Start → Big?`，控制台 0 error。
- Form Elements 的可选属性已按本地 n8n 收进 `Add Attributes` 菜单，File 下动态提供 Multiple Files / Accepted File Types / Required Field；公开表单有文件字段时自动输出 `enctype="multipart/form-data"`。
- 仍需明确的边界：SQL 沙箱与本地 n8n 同为 AlaSQL 4.4.0，但 Nomops 目前最多 10 个 Merge 输入；Define Below 只接受 Nomops 可识别的导出节点类型，不自动翻译 `n8n-nodes-base.*` 节点；上传总量上限是 Nomops 的安全部署默认值，不等同所有 n8n 实例的环境变量配置。

### 2026-08-14 节点级复核（Data Table）

- Data Table 不再是目录缺口：Row 已覆盖 Delete/Get/If Row Exists/If Row Does Not Exist/Insert/Update/Upsert，Table 已覆盖 Clear/Create/Delete/List/Rename。
- NDV 的 Data table locator 对齐 From List/By Name/ID；Columns 改为动态 resource mapper，可在自动映射和逐列手工映射间切换，并由所选项目表的列 schema 驱动类型化字段。
- 执行边界不是前端传 projectId：服务端只向节点注入当前项目 Data Table helper，动态选项、动态列 schema 与执行操作均按项目归属过滤。
- 隔离生产实例完成 Manual Trigger → Data Table Insert，Output 返回 1 item，数据库回读写入值一致，浏览器控制台 0 error。

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
| ~~P2-2 / P2-3~~ → **EPIC-EVAL** | 评测/测试子系统 | Debug in editor + 执行标注 + 评测数据集 + 评测运行 | **重新归类（2026-07-21 复验）**：这不是 P2 小修，而是 **n8n 整套评测/测试子系统**。查实 Nomops **零后端**：无 evaluation/dataset/testrun/metric 服务、无 annotation、无 Debug-in-editor。Nomops Evaluations tab 是「Register to enable」锁态占位（`CanvasView.vue:972`）；n8n 本地实例则显完整 setup 向导（test dataset→eval trigger→quality score→Run in editor）。→ 补齐 = 从零建 dataset/eval-trigger/test-run/metric/annotation/debug 全链（后端+引擎+UI），**epic 级产品倡议，非对齐小修**。**建议单独立项规划**，本对齐任务范围外。 | XL | n8n `features/ai/evaluation.ee/*` + `EnterpriseEdition.DebugInEditor` |
| ~~P2-4~~ ⊘**不做（复验后收回）** | 凭证 | 字段控件 | ~~凭证字段缺 Fixed/Expression 切换~~ | M | — |<br>**复验（2026-07-21）**：凭证的"表达式"只有 `{{ $secrets.KEY }}`——注入前由 `secrets-service.ts` 物化，**无 `$json`/item 上下文**（凭证在节点执行前解析）。套用节点参数的 `ParamInput`/`ExpressionInput`（面向 `$json` 逐项）会**误导**用户以为支持 item 表达式；且 `$secrets` 现可直接在文本框内联输入、已工作。→ naive 复用不做；真要做需**凭证专属表达式模式**（仅 `$secrets`/env 自动补全），另立独立任务，非小修。 |
| ~~P2-5~~ ✅**已修（全量对齐）** | Settings/Environments | Git 源码同步 | ~~欠功能~~ | L | `git-service.ts` + `SettingsView.vue` sourcecontrol 段 |<br>**已修（2026-07-21，用户指正后提级重做）**：原判"自托管取舍不动"判轻了。全量对齐 n8n，分 5 增量：**① 应用内 SSH 部署密钥**（ED25519 生成/展示/Copy/Refresh，私钥 Cipher 加密落库）+ Connection Type(SSH/HTTPS)；**② 远端分支下拉 + 切换**；**③ 选择性 Push 弹窗**（勾选工作流 + commit）+ **Pull 预览**（列 new/existing 再确认）；**④ 同步范围**扩到 变量 + 标签；**⑤ Connect 加载动画 + Instance settings**（Branch + **Protected instance 只读实例**（真 enforcement：受保护时工作流 create/update/delete/publish 拦 403）+ **Color 环境色标** + Save settings + "successfully saved" 提示 + Disconnect Git）。验证:20 后端（含 protected 拦编辑）+ 63 前端测试 + live 全 UI。凭证仍不同步（守铁律 3）。 |
| P2-6 | Settings/Log Streaming | destination | Nomops webhook-only 内联表单（Name/URL/Signing/2 事件）；n8n 多 destination 类型(webhook/syslog/sentinel) + 卡片 + modal + 细粒度事件树 | L | `SettingsView.vue` logstream 段 |
| P2-7 | Settings/External Secrets | provider | Nomops 仅 env-var provider（`NOMOPS_SECRET_<KEY>`）；n8n 多 vault provider(Vault/AWS/Azure/GCP/Infisical) | L | `SettingsView.vue` secrets 段 |
| P2-8 | 画布 | 顶栏 `⋯` | 菜单项需补齐核对（Settings / Push to git 等），当前 Download/Duplicate/Import/Delete | S | `features/canvas/.../CanvasHeaderMenu` |
| ~~C-1~~ ⊘**不做（复验后收回）** | Chat | 输入栏 | ~~缺 附件 + 语音按钮~~ | — | — |<br>**复验（2026-07-21）**：附件/语音在 Nomops **无任何后端/基建**——chat 流不支持附件（`attachments` 是 n8n DB 字段非 Nomops）、全库无 transcription/speech。加空按钮=P2-4 式误导；真做要上多模态(附件)+STT(语音)，**远超 P2 小修**，语音还牵扯"自托管是否依赖浏览器云端 STT"的架构取舍。Nomops chat 属**刻意纯文本**设计。→ 收回；多模态/语音如需，另立独立大任务。 |

> **P2-5/6/7 性质**：多为 Nomops 自托管务实取舍（用宿主 git、env-var secrets、webhook 日志），**功能可用**，非必改；若目标是 100% 对齐 n8n 的 IA/能力面才列改造。

---

## ✅ 已核实一致（原 ⏳ 已清，无需改造）
- **Node Creator**：`What triggers this workflow?` + 9 策展触发器（含 evaluation，逐字对齐）。
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

## 最终状态（2026-07-21 收官）
**UI 对齐工作已实质完成。** 全部真 gap 已处置：
- ✅ **已修 4**：P1-4 变量墙、P1-2 NDV Pin data、P1-3 凭证自动测连接、P2-1 执行头元信息（均已提交 + 推 origin/main）。
- ❌ **误报撤销 2**：P0-1 Agent Chat 闭环、P1-1 执行按钮多触发器下拉（功能早已存在，审计截错工作流所致）。
- ⊘ **复验后收回 2**：P2-4 凭证字段表达式（会误导，无 item 上下文）、C-1 Chat 附件/语音（无后端基建）。
- 🏔 **归入 EPIC-EVAL**：原 P2-2/P2-3 = n8n 整套评测/测试子系统，Nomops 零后端，**epic 级产品倡议，非对齐 gap**。
- 🔒 **刻意设计取舍（不动）**：P2-5/6/7（Environments/Log Streaming/External Secrets 自托管简化）、Templates 自托管本地库、Projects 独立管理页。

**结论**：Nomops 与 n8n 基线在信息架构 + 交互行为上已高度对齐；剩余差异要么是自托管刻意取舍，要么是需另立项的企业级 epic（评测子系统）。对齐任务收官。

### 2026-08-13 协同编辑安全地基

- workflow 保存已从末位写覆盖改为内容版本乐观锁：陈旧客户端得到 409，服务端保留胜出版本。
- 画布保留冲突会话的本地草稿并提供显式确认重载，不自动丢改；重叠 autosave 串行合并。
- editor 持久修改已收敛到 `_applyPersistentChange` 单入口。presence、CRDT 和命令式 undo 仍是后续协同层能力，不混入本次安全地基。

## 剩余可选细项（非对齐 gap）
- **EPIC-EVAL**（评测/测试子系统）：如要做，单独立项——建 dataset/eval-trigger/test-run/metric/annotation/Debug-in-editor 全链。
- 审计边角：凭证 Sharing/Details/OAuth 流、执行批量停止条 + 错误 toast、Data table 详情、认证 SSO 入口、Admin/Audit 字段级——都不影响对齐主结论。
