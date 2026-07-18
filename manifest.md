# n8n 1:1 复刻 — 阶段一侦察清单 (manifest)

> 事实来源:运行中的 http://localhost:5679/(唯一依据,全部条目均为实际访问取证)
> 侦察时间:2026-07-17
> 目标版本:**n8n 2.30.4 (stable) · Community 许可**(`/rest/settings` 实测)
> 主题:深色(账号 Theme=System default,当前渲染为 dark)
> 说明:每项前的 `[ ]` 为实现进度勾选框。标注 **⚠待补** 的条目 = 本轮未能取证(原因注明),必须回到页面二次侦察后才许实现,禁止凭记忆编造。

---

## 0. 路由总表(从运行实例 Vue Router 全量导出)

实测导出共 110+ 条注册路由。按可达性分组:

### 0.1 已实测访问(本清单有对应章节)
| 路由 | name | 状态 |
|---|---|---|
| `/home/workflows`(`/`、`/workflows` 重定向至此) | WorkflowsView | ✅ 已探 |
| `/home/credentials/:credentialId?` | CredentialsView | ✅ 已探 |
| `/home/executions` | Executions | ✅ 已探 |
| `/home/variables` | HomeVariables | ✅ 已探(Community 锁) |
| `/home/datatables` | data-tables | ✅ 已探(空态) |
| `/insights/:insightType?` | Insights | ✅ 已探(Community 锁) |
| `/home/chat` | chat | ✅ 已探 |
| `/home/chat/personal-agents` | chat-personal-agents | ✅ 已探(空态) |
| `/home/chat/workflow-agents` | chat-workflow-agents | ⚠待补(未访问,预计同构空态) |
| `/shared/workflows`、`/shared/credentials` | SharedWorkflows / SharedCredentials | ✅ 已探(空态) |
| `/projects` | Projects | ✅ 实测重定向 → `/home/workflows`(Community 无项目) |
| `/workflow/new`、`/workflow/:workflowId/:nodeId?` | NodeViewNew / NodeViewExisting | ✅ 已探 |
| `/workflow/:id/executions`、`/workflow/:id/executions/:execId` | WorkflowExecutions / ExecutionPreview | ✅ 已探(空态+有数据两态) |
| `/workflow/:id/evaluation` | Evaluation | ✅ 已探(注册门) |
| `/workflow/:id/history/:versionId?` | WorkflowHistory | ✅ 已探 |
| `/settings/*` 全部 14 个子页 | 见 §8 | ✅ 已探 |
| `/templates/` | TemplatesSearchView | ✅ 实测:**302 跳外站 n8n.io/workflows**(应用内无模板库页) |

### 0.2 存在但本轮未取证(⚠待补,按风险/依赖标注)
| 路由 | 原因 |
|---|---|
| `/signin` `/signup` `/setup` `/forgot-password` `/change-password` `/signout` | 已登录态访问会被路由守卫重定向;`/signout` 会丢当前会话。**需专门安排一次可重新登录的侦察**(拿到账号密码或允许登出) |
| `/workflow/:id/debug/:executionId` | Debug 模式入口(执行列表 ⋮ → Debug in editor)未点开 |
| `/projects/:projectId/*` 全家(settings/variables/datatables/agents…) | Community 许可下项目功能锁死,无法进入 |
| `/settings/roles` 的 instance-roles/project-roles new/edit/view 子页 | Enterprise 锁,仅到列表层 |
| `/workflows/demo`、`/workflows/demo/diff`、`/workflows/onboarding/:id`、`/workflows/templates/:id`、`/collections/:id`、`/templates/:id`、`/templates/:id/setup` | 模板/演示流,需模板源;本实例跳外站 |
| `/oauth/consent`、`/saml/onboarding` | 需要真实 OAuth/SAML 流程触发 |
| `/entity-not-found/:type`、`/entity-not-authorized/:type`、`/:pathMatch(.*)*` (404) | 未访问,低风险,二轮补截图 |
| `/home/folders/:folderId?/workflows` | 未建文件夹;列表页有 Add folder 按钮(见 §2) |
| `/home/agents`、`/new-agent`、`/assistant/:threadId`、`/resource-center`、`/settings/agent-builder` 等 AI 扩展路由 | 未逐个访问,二轮补 |

---

## 1. 全局应用壳(主侧栏 + 顶部工具)

### 1.1 主侧栏(左)
- [ ] 折叠态:仅图标列(+、搜索、侧栏开关、Overview、Chat、底部 4 图标),宽 ~50px
- [x] 展开态:n8n Logo(粉红色 logo + 字标)、条目带文案
- [x] 条目:Overview(房子图标,当前页高亮=浅色背景块)
- [x] 条目:Chat + 紫色 `Preview` 徽章
- [ ] 底部条目:Templates(**外链** n8n.io/workflows,带 UTM 参数)
- [ ] 底部条目:Insights(图标右上角有红点通知)
- [ ] 底部条目:Help(chevron)→ 悬浮子菜单:Quickstart(视频图标)/ Documentation / Forum / Course / Report a bug / About n8n / 分组标题 "What's new" / What's new 条目(如 "Connect your tools in one click")/ Full changelog / **Update (1 version behind)**(橙色感叹号,版本落后提示)
- [ ] 底部条目:Settings(chevron)→ 悬浮子菜单 16 项:Usage and plan / Personal / Users / Roles(灰色 `New` 徽章)/ n8n API / External Secrets / Environments / SSO / Security & policies / LDAP / Log Streaming / OpenTelemetry / Community nodes / Instance-level MCP(`Preview`)/ Chat(`Preview`)/ **Sign out**(分隔线下)
- [x] 状态:hover(条目浅色背景)、active(当前路由高亮)、折叠/展开切换动画(折叠宽度待量)

### 1.2 顶部工具(侧栏头)
- [ ] `+` Add new item 下拉:New workflow / New credential / New data table / New project(灰置禁用 + `Enterprise` 徽章)
- [ ] 搜索按钮 → **命令面板**(模态,半透明遮罩):
  - [x] 全局态:输入框 "Type a command or search...";分组 Workflows(Create workflow in Personal / Open workflow)、Credentials(Create credential in Personal / Open credential)、Data tables(Create data table in Personal / Open data table)
  - [ ] 工作流上下文态(编辑器内触发):作用域徽标 "Workflow · <名称>";分组 Recent:`Open <节点名>`(带节点图标)逐节点命令
- [ ] 侧栏折叠/展开开关(双栏图标)

### 1.3 文档标题/图标状态(实测)
- [ ] 列表页 title:`Workflows - n8n` / `Credentials - n8n` / …
- [ ] 编辑器 title 前缀 `▶️ <workflow名> - n8n`
- [ ] 兜底 title:`n8n.io - Workflow Automation`

---

## 2. Overview 页 `/home/workflows`(五 Tab 容器)

### 2.1 页面框架
- [ ] H1 "Overview" + 副标题 "All the workflows, credentials and data tables you have access to"
- [ ] 右上主按钮 **Create workflow**(橙色)+ 右侧 caret 分裂下拉(⚠待补:caret 菜单内容未点开)
- [x] KPI 条(5 格,可点击,分别链接 `/insights/total|failed|failureRate|timeSaved|averageRunTime`):Prod. executions / Failed prod. executions / Failure rate(%)/ Time saved(`--` 空值 + ⓘ tooltip)/ Run time (avg.)
- [x] Tab 行:Workflows / Credentials / Executions / Variables / Data tables(激活态:橙字 + 橙色下划线)

### 2.2 Workflows Tab
- [x] 工具行:Search 输入(放大镜前缀)、Sort by last updated 下拉(选项已实测)、Filters 漏斗按钮、Add folder 按钮(文件夹+号图标)
- [ ] Filters 弹层(实测):分组 Tags → "Filter by tags" 多选下拉;分组 Status → "All" 下拉(⚠待补:选项枚举);复选框 "Show archived workflows"
- [x] 列表卡片:名称、`Last updated X ago | Created <date>`、共享链接徽章(链条图标+数字,仅共享时显示)、`Personal` 徽章(人形图标)、`⋮` 菜单(⚠待补:菜单项枚举——预计 Open/Share/Duplicate/Download/Archive 等,须实测)
- [ ] 卡片状态:hover(边框/底色变化 ⚠待补取证)、点击整卡进入编辑器
- [x] 分页条:`Total 4` + 前后翻页箭头 + 当前页号(橙色描边)+ `50/page` 页大小下拉
- [ ] 空态:⚠待补(实例有数据;可临时过滤出空结果取证)

### 2.3 Credentials Tab(即 `/home/credentials`)
- [x] 主按钮变为 **Create credential**(+caret)
- [x] 工具行:Search credentials... / Sort by last updated / 漏斗
- [x] 卡片:服务图标(26×26 裸图,实测)、名称、`<类型名> | Last updated … | Created …`、使用计数徽章、Personal 徽章、⋮ 菜单(Open/Delete,已实测)
- [x] **Add new credential 模态**(实测):标题、X、说明 "Select an app or service to connect to"、可搜索下拉 "Search for app..."(展开=字母序全类型列表:Action Network API、ActiveCampaign API、Acuity Scheduling API…)、**Continue** 按钮(未选择时禁用态)
- [x] **凭证编辑模态**(实测,以 OpenAI 为例):头部(品牌图标、名称 "OpenAI account" 可改、副标题=类型名、**Save** 按钮、X);左侧 Tab:Connection / Sharing / Details
  - [ ] Connection:提示条 "Need help filling out these fields? Read our docs"(链接);字段 API Key*(必填星号)、Organization ID (optional)+帮助文本、Base URL(默认值 `https://api.openai.com/v1`)、Add Custom Header 开关
  - [ ] Sharing:Community 锁 → 虚线框 "Upgrade to collaborate" + View plans 按钮
  - [ ] Details:未保存时为空白(⚠待补:已保存凭证的 Details 内容)
  - [ ] ⚠待补:已保存凭证的 **Test connection / 连接测试**状态区、红/绿结果条(本仓库已有对标实现,但 n8n 原样式需回访已保存凭证取证)

### 2.4 Executions Tab(即 `/home/executions`)
- [x] 工具行:`Auto refresh` 复选框(橙色勾选态)+ 漏斗按钮
- [x] 表格列:全选复选框 / Workflow / Status / Started / Run Time / Exec. ID / (试管图标=manual 执行标记) / ⋮
- [x] 行状态:Error(红叉图标+整行 rgba(215,56,58,.1) 底,实测)、Success(绿勾图标)、时间格式 `Jul 16, 16:54:24`、耗时 `116ms`
- [ ] ⋮ 行菜单(⚠待补:预计 Retry / Delete / Debug in editor,须实测)
- [x] 批量选中后的操作条(nomops 已有浮条实现)

### 2.5 Variables Tab
- [ ] Community 锁定态(实测):右上 Create variable 按钮(半透明禁用)+ 虚线大框:标题 "Upgrade to unlock variables"、说明(含 `$vars` 代码字体、"Learn more in the docs." 橙链)、**View plans** 橙色按钮
- [ ] 解锁后的表格形态:⚠不可取证(Community 无法解锁)——实现按锁定态

### 2.6 Data tables Tab
- [ ] 空态(实测):虚线框 + "You don't have any data tables yet" + 说明 + **Create data table** 橙按钮
- [ ] Create data table 模态:⚠待补(未点开,避免造数;二轮侦察时创建后即删)
- [ ] 数据表详情页 `/projects/:id/datatables/:id`:⚠待补(同上)

---

## 3. Insights `/insights`
- [ ] 头部:H1 "Insights";过滤条:"All projects" 选择器 + 日期范围 chip `10 Jul - 17 Jul, 2026`(日历图标)
- [ ] KPI 摘要条区域(顶部空白条,Community 下无数据渲染)
- [ ] 主体:锁样式空态 —— 锁图标、"Upgrade to access more detailed insights"、说明文案、**Upgrade** 橙按钮
- [ ] `/insights/total|failed|failureRate|timeSaved|averageRunTime` 深链:⚠待补(未逐个访问;预计同页不同选中 tab)

---

## 4. Chat 壳 `/home/chat`(独立布局)
- [ ] 专用侧栏:顶部(logo、搜索、侧栏开关——无 `+`);**New chat**(+ 图标,高亮当前);Personal agents;Workflow agents;历史分组标题 "Today" + 会话条目(带模型图标);底部仅 Settings
- [ ] 顶栏:**Select model** 下拉(气泡图标+caret)(⚠待补:展开后的 provider/model 级联内容)
- [ ] 主区空态:"Select a model to start chatting"
- [ ] composer:上方紫色信息条 "ⓘ Please select a model to start a conversation"(select a model 为下划线链接);输入区 placeholder "Select a model";左下 **+ Tools** 按钮;右下 回形针(附件)、麦克风、橙色发送按钮(↑)
- [ ] Personal Agents 页 `/home/chat/personal-agents`:H1 + 副标 "Create and manage custom AI agents with specific instructions and behaviors"、右上 **+ New Agent** 橙按钮、空态文案 "No personal agents available. Create your first custom agent to get started."
- [ ] Workflow agents 页:⚠待补
- [ ] 发消息/流式回复/工具调用等会话态:⚠待补(需配置 provider key 后实测)

---

## 5. Shared with you `/shared/workflows`
- [ ] H1 "Shared with you" + 副标 "Workflows and credentials other users have shared with you"
- [ ] 右上 Create workflow 按钮;Tab:Workflows / Credentials
- [ ] 提示条:"Archived workflows are hidden in this view. Update filters"(链接)
- [ ] 空态:"No workflow has been shared with you" + **Back to Personal** 链接/按钮

---

## 6. Projects
- [ ] `/projects` 在 Community 下重定向 `/home/workflows`(实测);侧栏无项目区
- [ ] `+` 菜单中 New project 禁用 + Enterprise 徽章(实测)
- [ ] 项目内页全家:⚠不可取证(许可锁)

---

## 7. 工作流编辑器 `/workflow/:id`(核心)

### 7.1 顶栏
- [ ] 面包屑:人形图标 + `Personal` / 工作流名(超长省略号截断,可点击改名 ⚠待补改名交互)
- [ ] `+ Add tag` 幽灵按钮(⚠待补:点开后的 tag 输入/下拉)
- [ ] 居中 Tab 胶囊:Editor / Executions / Evaluations(当前项深色底)
- [ ] 右侧:`0 / 1` 发布计数徽章;**Publish** 按钮(无改动时禁用)+ caret 下拉:Publish(⇧P,禁用态)/ View timeline / Unpublish(⌘U,禁用态);历史时钟图标 → History 页;`⋯` 菜单:Edit description / Duplicate / Download / Rename / Favorite / Import from URL… / Import from file… / Push to git(禁用,未接 git)/ Settings / **Archive**(红色危险项)
- [ ] **Workflow settings 模态**(实测):标题含名称与 `#ID`;字段:Execution Logic(`v1 (recommended)`)/ Error Workflow (`- No Workflow -`) / Timezone (`Default - America/New York`) / Save failed production executions (`Default - Save`) / Save successful production executions / Save manual executions / Save execution progress (`Default - Do not save`) / Redact production execution data(灰 + `Upgrade` 徽章)/ Redact manual execution data(同)/ **Save** 按钮

### 7.2 画布
- [ ] 点阵背景;滚轮=垂直平移,Shift/横向滚=水平平移,缩放(⚠待补:精确手势/快捷键映射需实测确认 Ctrl+滚轮等)
- [x] 节点卡:96×96 方卡(bg light-1/1.5px 白 63% 边/圆角 8/图标 48/label 卡下 192px 白字 14px,实测);触发器左弧;选中态 = --canvas--color--selected 描边
- [ ] 端口:左输入/右输出圆点;输出端 `+` 快捷加节点;IF 节点多输出带 `true` / `false` 文案标签
- [ ] AI Agent 节点:下缘菱形子端口 Chat Model*(红星必填)/ Memory / Tool,各带 `+`;子节点(圆形大图标卡,如 "研判 Chat Model")经 **虚线连线 + 中点菱形 + 线上标签(Model)** 挂接
- [ ] 连线:灰色贝塞尔曲线;线中 `+`(插入节点)(hover 态 ⚠待补:插入/删除工具条)
- [x] 便签 Sticky Note:颜色全改 --sticky--* 令牌(dark 实测:蓝=blue-900/800)、圆角 4、240×160;markdown/双击编辑存量已有;拖拽调宽+调色板 UI 留编辑器后续批次
- [ ] 右侧竖排工具rail:`+`(打开节点创建面板)/ 放大镜(命令面板·工作流域)/ 便签图标(⚠待补:点击行为未取证,预计新建便签)/ 面板开关(Focus Panel)
- [ ] 左下控制组:适配视图 ⛶ / 放大 / 缩小 / (有历史后)撤销 / 魔杖 Tidy up
- [ ] 底部中央:**Execute workflow**(试管图标)橙色分裂按钮,副文案 `from 每日巡检 Schedule`(多触发器时选择起点)+ caret(⚠待补:下拉列出可选触发器)+ **Open chat / Hide chat** 切换按钮(工作流含 Chat Trigger 时)
- [ ] 键盘:`1`=fit(⚠未生效需复核)、Space=改名、R=Replace、D=Deactivate、P=Pin、⌘C/⌘D、⇧⌥T、⌥X、Del(均来自右键菜单快捷键标注,实测菜单存在)

### 7.3 节点右键菜单(实测 13 项)
- [ ] Open…(↵)/ Execute step / Rename(Space)/ Replace(R)/ Deactivate(D)/ Pin(P,数据未执行时禁用)/ Copy(⌘C)/ Duplicate(⌘D)/ 分隔 / Tidy up workflow(⇧⌥T)/ Convert node to sub-workflow(⌥X)/ 分隔 / Select all(⌘A)/ Clear selection / Delete(Del)
- [ ] 画布空白处右键:⚠待补(预计 Add node/Paste/Select all…)

### 7.4 节点创建面板(右抽屉)
- [x] 触发器已存在时标题 "What happens next?";搜索框 "Search nodes..."
- [ ] 一级分类(实测 7 项):AI / Action in an app / Data transformation / Flow / Core / Human review / Add another trigger(每项:图标+标题+描述+右箭头)
- [ ] AI 子面板(实测):返回箭头 + "AI Nodes" 标题 + 副标;置顶 "AI Templates" + `Recommended` 徽章;列表:AI Agent / Anthropic / Google Gemini / Guardrails / MiniMax / Moonshot Kimi / …(长列表,完整枚举 ⚠待补=实现期直接读 `/types/nodes.json`)
- [ ] 其余 6 个分类的子面板逐级枚举:⚠待补(二轮;同样可由 nodes.json 驱动,但面板层级/分组文案必须实测)
- [ ] 无触发器空画布的首屏面板("What triggers this workflow?"):⚠待补(`/workflow/new` 首开即是,未截图)

### 7.5 NDV(节点详情视图,三栏模态)
- [x] 框架:全屏遮罩(black-alpha-600)+ 模态左右/底 25px 露画布 + 顶部 66px 头带;三栏=侧 375px 定宽(bg light-3)/中弹性(bg light-1,4px 拖柄),底角 8 圆角(实测);改名/相邻 chip 待后续
- [x] INPUT 栏(普通节点):标题 INPUT(12px-600 白大写宽字距);空态 = "No input data"(16px-600)+ Execute previous nodes(32px primary)+ "to view input data";有数据态 Schema/Table/JSON 存量已有
- [ ] INPUT 栏(AI 子节点):左上 `Mapping | From AI` 分段切换(实测于 Chat Model)
- [ ] 中栏:`Parameters | Settings` Tab + **Execute step**(试管)按钮
- [ ] Settings Tab(实测,IF 节点):Always Output Data / Execute Once / Retry On Fail 三开关;On Error 下拉(`Stop Workflow`);Notes 多行文本;Display Note in Flow? 开关;底部版本注记 "If node version 2.2 (Latest version: 2.3)"
- [x] OUTPUT 栏:空态 = "No output data" + Execute step + "to view output data" 已实现;set mock data 链/铅笔/子节点变体文案留后续批
- [ ] 底部居中反馈链接:"💡 I wish this node would..."
- [ ] 参数控件形态(已实测样本):
  - IF:Conditions 组(左值表达式框 + 操作符下拉 `is not equal to`(前缀类型图标 T)+ 右值输入)、**Add condition**、`Convert types where required` 开关、组级 `Fixed|Expression` 切换、Options 区 + Add option
  - HTTP Request:**Import cURL** 按钮;Method 下拉;URL;Authentication 下拉(None);Send Query Parameters / Send Headers / Send Body 开关(开=橙);Body Content Type(JSON);Specify Body(Using JSON);JSON 代码编辑框(fx)
  - AI Agent:顶部紫色 Tip 条(tutorial/example 链接,可关);Agent 下拉(Tools Agent);Source for Prompt 下拉;Prompt 表达式框;Require Specific Output Format 开关;Options;System Message 大文本;**底部子节点连接条**:Chat Model*(错误=红圈高亮)/ Memory `+` / Tool `+`
  - LLM 子节点(lmChatOpenAi):**Credential 选择器**("No credentials yet" 下拉 + **Set up credential** 按钮);Model 资源定位器(左模式下拉 + 右值输入 `gpt-4o-mini`);Options + Add Option
- [ ] 表达式编辑:聚焦 fx 字段 → 悬浮工具条(打开 Focus Panel 图标 / ⋮ / `Fixed|Expression`);下方 **Result 预览面板**(`Item` 计数 pager ‹ ›、结果 "[Execute previous nodes for preview]"、Tip 行)
- [ ] **Focus Panel**(右侧抽屉,实测):Tab `Setup | <参数名>`;参数行头(`Left 有异常?`)+ 运行 ▶ 按钮 + X;提示 "ⓘ Execute previous node for autocomplete";大号表达式编辑区;`Fixed|Expression` 切换
- [ ] 表达式自动补全下拉 / `$json` 变量树:⚠待补(需输入触发实测)

### 7.6 底部 Chat / Logs 面板
- [ ] 收起态:底部细条 `Chat | Session: xxxx… | ↺` + `Logs` + 右侧弹出窗图标 + 展开 chevron
- [ ] 展开态:左 Chat 面板(消息区空白、输入框 "Type message, or press 'up' for previous one"、纸飞机发送);右 Logs 面板(空态 "Nothing to display yet. Execute the workflow to see execution logs."、`⋯` 菜单 ⚠待补、收起 chevron)
- [ ] 执行后 Logs 树(逐节点耗时/状态)与 Chat 会话流:⚠待补(需真实执行)

### 7.7 Workflow History `/workflow/:id/history`
- [ ] 布局:全屏;左=只读画布(斜纹底纹);顶栏:工作流名、"Current changes" 标签、**Actions** 下拉(⚠待补:菜单项 Restore/Clone/Open/Download 需实测)
- [ ] 右侧栏:Tab `Versions | Publish Timeline`;版本条目(黄点 + "Current changes" + `Kane Guo, Jul 17 at 22:11:21` + ⋮);折叠组 "1 version";底部提示 "Version history is limited to 1 day / **Upgrade plan** to activate full history"
- [ ] Publish Timeline Tab 内容:⚠待补

### 7.8 Executions Tab `/workflow/:id/executions`
- [ ] 左栏:标题 Executions;`Auto refresh` 复选框 + 漏斗;执行条目(时间、状态色、重试图标、试管=manual 标记);选中高亮
- [ ] 空态(实测):左栏 "No executions found";主区 "Nothing here yet" + 折叠问答 "Which executions is this workflow saving?"(chevron 展开 ⚠待补内容)
- [ ] 执行详情(实测):顶条 = 执行时间标题 + **Copy to editor** 按钮 + 垃圾桶;主区只读画布(斜纹背景、执行时点的节点/便签快照);节点级输出查看/Debug 入口 ⚠待补

### 7.9 Evaluations Tab
- [ ] Community 未注册态(实测):标题 "Test your AI workflow over multiple inputs" + 说明 + More info 链接;左=视频嵌入区;右=虚线框 "Register to enable evaluation" + 说明 + **Register instance** 橙按钮
- [ ] 注册/许可解锁后的 runs 列表与 `/evaluation/test-runs/:runId`:⚠不可取证(锁)

---

## 8. Settings 区(独立壳:左侧专用侧栏 + 返回箭头 "Settings" + 底部橙色 `Version 2.30.4`)

- [ ] **Usage and plan**:H1;"You're on the Community Edition";Unlock 高亮条(米黄描边)"Unlock selected paid features for free (forever)";指标行 "Published workflows — 0 of unlimited";ⓘ 注释行;按钮 **Enter activation key**(次要)+ **View plans**(橙);Enter activation key 弹窗 ⚠待补
- [ ] **Personal**:右上用户名+`Owner`+渐变圆头像(姓名缩写);分区 Basic Information(First Name* / Last Name* / Email*)、Security(Password → Change password 橙链;2FA 说明 + **Enable 2FA** 按钮)、Personalisation(Theme 下拉,当前 System default;选项枚举 ⚠待补)、底部 **Save**(未改动禁用);Change password / Enable 2FA 弹窗 ⚠待补
- [ ] **Users**:H1 + "1 user";Upgrade 提示条(米黄)"Upgrade to unlock the ability to create additional admin users";搜索 "Search by name or email";**Invite** 橙按钮(Community 下点击行为 ⚠待补);表格列 User(头像+名+邮箱)/ Account Type(Owner)/ Last Active(Today)/ 2FA(Disabled)/ Projects(All proj…,列宽截断)/(行尾 ⋮ ⚠待补)
- [ ] **Roles**:H1+`New` 徽章+说明(documentation 链接);Tab `Instance roles | Project roles`;主体 Enterprise 锁:三张权限卡图形 + "Upgrade to Enterprise" + 说明 + **Learn more ↗**(次要)+ **Upgrade**(橙);Project roles tab ⚠待补(预计同锁)
- [ ] **n8n API**:H1 "API";虚线空态框:"Control n8n programmatically using the n8n API"(橙链)+ **Create API key**;创建后的 key 列表/scopes 表单 ⚠待补(避免造 key,二轮建后即删)
- [ ] **External Secrets**:说明 + 虚线框 "Available on the Enterprise plan" + **See plans**
- [ ] **Environments**:同上锁样式 + 说明 "Use multiple instances for different environments (dev, prod, etc.), deploying between them via a Git repository. **More info**"
- [ ] **SSO**:H1 "Single Sign-On" + 说明(SAML 2.0/OIDC, documentation 链接)+ Enterprise 锁框("Use Single Sign On to consolidate…")+ See plans
- [ ] **Security & policies**:说明;分区 ①Enforce two-factor authentication:开关行 + `Upgrade` 胶囊徽章 + 描述;②Data redaction:Enforce data redaction 开关(Upgrade)+ Learn more;Redact executions 下拉 `Production executions (Recommended)`(Upgrade);指标行 Affected scope — No executions;③Personal Space:Sharing(Upgrade)+ 描述 + 指标行 Existing shares — 0 workflows, 0 credentials;Workflow publishing(Upgrade)+ 指标行 Existing published workflows — 0 workflows
- [ ] **LDAP**:说明(Active Directory/Okta/Jumpcloud)+ Enterprise 锁框 + See plans
- [ ] **Log Streaming**:说明(More info 链接)+ Enterprise 锁框 + See plans
- [ ] **OpenTelemetry**(本实例扩展页,字段全):Enable OpenTelemetry(下拉 `Disabled`,选项枚举 ⚠待补);分区 Collector connection:OTLP endpoint(占位 `http://localhost:4318`)/ Service name(`n8n`)/ Custom headers(**+ Add header** 按钮,行编辑 ⚠待补)/ Trace path(`/v1/traces`)/ Startup connectivity timeout(数值 `2000` + 后缀单位 `ms`)/ Verify configuration(**Send test trace** 按钮);分区 Tracing:Trace sample rate(`of 1.00`)/ Include node spans / Inject outbound traceparent / Track published workflows only(开关组);底部 **Save settings** + **Discard changes**
- [ ] **Community nodes**:H1 + 右上 **Install** 橙按钮(安装弹窗 ⚠待补);包卡片:包名(`n8n-nodes-deepseek`)、"N node(s): 节点名列表"、右侧 `v1.0.6` + 更新检查 ✓ 图标 + ⋮ 菜单(⚠待补:预计 Uninstall/Update)
- [ ] **Instance-level MCP**:H1+`Preview` 徽章;右上 `Enabled` 绿色开关 + **Connection details** 按钮(弹窗 ⚠待补);警示横幅(棕底,OAuth redirect allowlist 提示,可关 ×);Tab `Workflows | Connected clients | OAuth settings`(后两 tab ⚠待补);Workflows 表(Name/Location/Description)空态 "No workflows enabled" + 说明 + **Enable workflows** 橙按钮;右上刷新图标
- [ ] **Chat(设置)**:Enable Chat 开关(绿);Providers 表(Provider/Models/Last edited/⋮):15 家(OpenAI / Anthropic / Google / Azure (API Key) / Azure (Entra ID) / Ollama / AWS Bedrock / Vercel AI Gateway / xAI Grok / Groq / OpenRouter / DeepSeek / Cohere / Mistral Cloud / NVIDIA Nemotron),各带品牌图标、"All models"、`-`;⋮ 配置弹窗(API key/模型白名单)⚠待补;右上刷新按钮

---

## 9. 鉴权/系统页(整组 ⚠待补,见 §0.2 原因)
- [ ] /signin(邮箱+密码表单、Forgot password 链接)— 待取证
- [ ] /setup(首装 owner 注册)— 待取证(实例已初始化,可能无法再现)
- [ ] /signup(受邀注册)、/forgot-password、/change-password — 待取证
- [x] 404 NotFound、entity-not-found — 已实测(见 field-specs §6);entity-not-authorized 同构(共享实体页组件)

---

## 10. 二轮侦察待办汇总(阶段三清账,细节见 field-specs.md)
1. [x] 列表卡片 ⋮ 菜单 — workflow:Open/Share.../Favorite/Duplicate/Archive/Enable MCP access;credential:Open/Delete;execution 行 ⋮:⚠人工残留
2. [x] Create workflow caret(Create credential/Create data table)、Sort 4 项、Status=All/Published/Unpublished、页大小 10/25/50/100
3. [x] Add folder — 实测为**注册引导弹窗**(未注册 Community 无文件夹;Skip / Send me a free license key)
4. [x] Create data table 模态 + 详情页(网格/系统列/Add Column 弹层含 string/number/boolean/datetime/删除确认)— 已建→截→删
5. [x] API key 创建弹窗(Label/Expiration=7\30\60\90\Custom\Never/Scopes=All\Read only\Custom,72 scopes)— 未落真实 key
6. [x] 空画布触发器面板 8 项全文案;节点创建面板骨架+搜索行为;其余分类子层级=nodes.json 数据驱动(916 节点已导出)
7. [x] NDV 有数据态:Schema/Table/JSON 切换、1 item、Clear execution、pin 图钉、set mock data、⚠过时徽标(经临时工作流实测,已删净)
8. [~] 表达式:Fixed/Expression、Result+Item pager、Tip、undefined 预览、Focus Panel 已取证;**自动补全弹层 ⚠人工**(合成键盘事件无法触发 CodeMirror 补全)
9. [x] Sticky:创建/默认文案/右键菜单/调色板 7 色+自定义彩虹色
10. [~] 执行取证:Logs 树(节点行+耗时+Input/Output 明细)、绿勾/绿线/`1 item` 标签已实测;Chat 会话流延后(需 provider key)
11. [x] Debug 路由 — 实测未注册 Community 下重定向回 /home/workflows(属注册特性 Advanced debugging)
12. [x] Chat:Select model 级联(15 provider+agents 两组)、Tools 未选模型时禁用、Configure OpenAI 弹窗全字段
13. [x] History Actions(Publish version/Clone to new workflow/Open version in new tab/Download)、Publish Timeline 空态
14. [ ] 鉴权页组 — 仍锁:需你授权登出或提供可重登凭证
15. [x] 404("Oops, couldn't find that/404 Error/Go back")、entity-not-found("Workflow not found/Go to overview")
16. [x] Share 弹窗(Community 升级引导)、Import from URL、Description 弹窗、Add tag(Choose or create a tag+Manage tags)
17. [~] "I wish this node would..." 入口已录(弹层未开);Publish 0/1→1/1 需真实发布(发布=激活触发器,留到阶段五用临时流验证)

**新增取证**:Users Invite 弹窗、Roles Project tab、Theme 3 选项、激活码弹窗、MCP Connection details(OAuth/Access token+Server URL)、Connected clients/OAuth settings tab、凭证连接测试红条、Personal 列表页变体、执行后节点"改动未重跑"橙色态。

---

## 附:取证记录(截图对应关系)
| 页面/组件 | 取证方式 |
|---|---|
| 路由总表 | `router.getRoutes()` 运行时导出 |
| 版本/许可 | `GET /rest/settings` |
| Overview 五 tab、Insights、Chat、Shared、Settings 14 页、编辑器、NDV×4、命令面板×2、右键菜单、⋯菜单、Publish 下拉、Help/Settings 子菜单、workflow settings 模态、凭证两模态、History、执行详情、Evaluations、Filters 弹层 | 逐页截图(会话内 40+ 帧) |
| 工作流节点结构 | `GET /rest/workflows/:id`(24 节点,含 4 便签) |
| 执行清单 | `GET /rest/executions` |

---

## 附 2:阶段四实现进度日志
**2026-07-18 · 阶段五收尾(Chat/命令面板复核 + 环境清理)**
- Chat:侧栏 240→200;composer dock 980→806(净宽 758 = n8n 实测);圆角/环/投影/hint 拼接复核 ✓
- 命令面板:[*,168,700,403]/输入行 48/20vh 顶距 —— 逐项吻合
- 清理:nomops 种子数据(2 流+1 凭证)API 删除;临时用户+孤儿 Personal 项目 DB 级清除(外键引用逐表清理),仅剩原 owner;n8n 侧零残留
- 产出 acceptance-report.md:7 组页面验收结果、5 项单侧测量纠错记录、10 项产品元素裁决表、5 项遗留清单
- 校验:build ✓ / vitest 22 ✓

**2026-07-18 · 阶段五 · 第 5-6 页(带节点画布 / NDV+Settings 复核)**
- 带节点画布(n8n 侧建同构临时流"UI Verify Tmp"对比后已删净):修正 4 项早前偏差——触发器左圆角 48→**36**;默认边框 α0.63→**white-alpha-200**(0.63 是选中/悬停态);节点 label 14→**16px**;连线 oklch(0.627)→**oklch(0.42)**;节点 96×96/bg/圆角 8/label 192 宽复核 ✓
- NDV 列宽新发现:侧栏弹性均分、中栏按节点型定宽(IF/HTTP 640,Set 420)——布局改为侧 flex + 中 640 定宽(与 IF 实测吻合);每节点宽度表记为后续项
- NDV Execute step [x,72,122,28] 复核 ✓
- Settings 复核:轨 230/条目 32px-14px-light-1/H1 28-400 ✓;轨衬 12→6(条目宽对齐 218)
- 校验:build ✓ / vitest 22 ✓;n8n 侧临时数据零残留

**2026-07-18 · 阶段五 · 第 2-4 页(Credentials / Executions / 编辑器 chrome)**
- Credentials:卡片[248,337,1144]/图标[264,359,26]/名称/meta 全部与 n8n 零差;工具行结构化 = Search+Sort(凭证列表新增排序支持)+漏斗弹层(Tags/Status/Show archived 收纳,替代三个独立切换钮,对齐 n8n);排序钮宽差 11px 记录
- Executions:表头/行 36/48 ✓;列宽锁定 n8n 真值(check50/WF371/Status153/Started187/RunTime110/ID98);"Run Time"→"Run time";工具行缩进 24;遗留=尾部 flask/retry 图标列需执行 mode 数据
- 编辑器 chrome:头带 65px/bg light-3/无底线;**Editor|Executions pill 重构为 n8n 真形**=居中悬浮 y48 压头带下缘、外层 neutral-800 衬 2 圆角 4、格 26px/12px-500、激活 bg light-2;右栏轨钮 36×36 ✓
- 校验:build ✓ / vitest 22 ✓ / 预览目视编辑器 chrome 与真身结构一致

**2026-07-18 · 阶段五开工(并排验收 · Overview 第一页)**
- 登录打通:dev DB 插入临时用户 ui-verify@nomops.local(admin,阶段五结束删除);本会话自起 server(5678, nomops.db);预览注入真实会话
- 造对比数据:2 工作流(其一含双节点)/1 次成功执行/1 凭证
- 验收方法升级:两侧同视口(1440×840)后**数值化对差**(getBoundingClientRect + 计算样式),不再目测截图
- Overview 差异清单→修复:①右 gutter 26→48+左对齐 x248;②头部 sub→KPI 间距 22→34;③页头按钮 34→32px(+secondary inset 环);④搜索宽 230→196;⑤顶衬 +4;⑥根目录隐藏 nomops 文件夹条(n8n 无);⑦筛选行下距 16→12
- **验收结果:KPI[249,101,228,99]、卡片[248,x,1144]、搜索[*,293,196,32] 与 n8n 逐像素一致**
- 遗留差异(记账):工具行 nomops 多一个 archive 独立钮(n8n 收在 Filters 弹层)→ 下轮结构化;Run live demo/Admin Panel 等产品项待裁决
- 校验:build ✓ / vitest 22 ✓

**2026-07-18 · 批次 9(Settings 壳 + Chat composer)**
- ✅ Settings 壳真值:返回行 43px/14px-500 白;条目统一主侧栏 32px 体系(衬 4/圆角 4/白字/图标 16/激活 light-1,原 圆角8+panel底 属偏差);版本脚注 12px primary
- ✅ Settings 表单系统:输入/下拉 36px/圆角 6/bg light-2/inset 环(:deep 作用于全部子页);primary 按钮 36px/圆角 6/衬 0 16
- ✅ Chat composer 真值:bg light-3/圆角 8/衬 8/1px 白环+微投影(原 10px 圆角+border 属偏差);textarea 16px 白/placeholder tint-1;聚焦环 = --focus--border-color;模型提示条紫系全部改令牌(--focus--border-color/--color--purple-alpha-100/purple-300)
- 校验:build ✓ / vitest 22 ✓ / 预览 Settings 壳目视全对齐 ✓

**2026-07-18 · 批次 8(节点创建面板 + NDV 头带)**
- ✅ 节点抽屉真值:宽 385/bg light-3;标题 18px-600 白;搜索 40px/圆角 4/聚焦 primary 边;分类条目=外距 0 12 0 16+衬 12px、题 14px-500 白、描述 12px --color--text(实测非弱化色)可换行、hover light-1;z-index 用 --node-creator--z
- ✅ NDV 头带补节点图标(24px 盒 + IconSvg)+ 名称 16px-400 白,结构对齐 n8n(图标+名 | 动作区)
- 校验:build ✓ / vitest 22 ✓

**2026-07-18 · 批次 7(参数控件 + 表达式编辑器)**
- ✅ NDV 参数区控件真值:label 12px-400 白(下距 8);文本输入 32px/bg light-2/inset 1px 环/圆角 4/14px 白;下拉 30px/1px 边/12px;行距 10;Import cURL 类小钮规格(24px/12px-500)已记录
- ✅ 布尔参数从原生 checkbox 升级为 n8n 开关:轨 32×16 胶囊、off = --switch--color--background + --switch--border-color、knob 12px --switch--toggle--color、on = --switch--color--background--active(green-500);测试同步更新(22/22 绿)
- ✅ 表达式编辑器:CodeMirror bg = --expression-editor--color--background、1px 边、圆角 0 4 4 0、内容 CommitMono 12px 白、衬 4 0 4 8;左侧 "=" gutter 块(20px,light-3 底)拼合;{{ }} 片段高亮改用 --expression-editor--resolvable--*--valid 绿系令牌
- 校验:build ✓ / vitest 22 ✓

**2026-07-18 · 批次 6(NDV 骨架 + 底部条)**
- ✅ NDV 重构为 n8n 真实布局:全屏浮层(--ndv--z/black-alpha-600 遮罩)、模态四周 25px 露画布、顶部 66px 头带、侧栏 375px 定宽 bg light-3、中栏弹性 bg light-1(--ndv--header--color)+4px 拖柄边、容器底角 8 圆角
- ✅ 中栏 tab 12px-600(激活橙/未激活 tint-1,原 13px 灰属偏差);Execute step 28px-13px primary(实测小号规格)
- ✅ DataPane:INPUT/OUTPUT 头 12px-600 白大写宽字距;空态升级 = 标题 16px-600 + 32px primary 动作钮 + 说明行(Execute previous nodes / Execute step 已接线)
- ✅ 画布底部:Execute workflow 36px/圆角 6/inset 环(去胶囊形+橙泛光,均属偏差);Logs 条 33px/bg light-2/12px-500 白
- 校验:build ✓ / vitest 22 ✓ / 预览编辑器 chrome 目视 ✓

**2026-07-18 · 批次 5(编辑器画布)**
- ✅ 节点卡真值:96×96 / bg --node--color--background(#2b2b2b) / 1.5px rgba(255,255,255,.63) 边(实测 oklch)/ 圆角 8(原 16 属偏差)/ 图标 48 / label 卡下 192px 宽白字 14px 两行截断
- ✅ 子节点圆 68→80px;selected/running/success/error 边色全部改令牌(running=primary,对齐 --node--border-color--running)
- ✅ 画布:底 --canvas--color--background、点阵 --canvas--dot--color、主连线 oklch(0.627 0 0) 2px(实测)、AI 虚线同色
- ✅ 便签:--sticky--* 七变体令牌、圆角 4、240×160;蓝便签实测 = blue-900 底/blue-800 边 ✓
- ✅ 缩放控制钮圆角 4/light-3 底
- 校验:build ✓ / 预览目视(空画布 chrome 全对齐)✓

**2026-07-18 · 批次 4(Executions 表格)**
- ✅ 表头:36px/bg light-1/12px-600 neutral-200/衬 0 8 0 16/底边 1px --color--foreground(neutral-800)
- ✅ 行:48px 高/衬 0 8 0 16/14px/底边 neutral-800;hover = --background--hover
- ✅ 错误行整行底色 rgba(215,56,58,.1)(实测专有值,注释注明无对应令牌)
- ✅ 状态列:白字 14px + 彩色图标(success/danger/primary 令牌)
- 校验:build ✓ / vitest 22 ✓

**2026-07-18 · 批次 3(Credentials)**
- ✅ 凭证列表:品牌图标改 26×26 裸图(去 32px 圆底框);行排版沿用已对齐的卡片体系
- ✅ Add new credential 模态:420px/圆角 8/标题 20px-400/说明 16px/组合框 48px(bg light-2)/Continue 36px-圆角 6;遮罩 = --dialog--overlay--color--background(slate-alpha-700)
- ✅ 凭证编辑模态:面板 70vw/圆角 8/el-dialog 实测阴影;头部名称 20px-400 + 26px 裸图标;左栏 tab 14px(激活 light-1 底);字段输入 36px/圆角 6/bg light-2
- 校验:build ✓ / vitest ✓ / 预览目视(空态+模态)✓

**2026-07-18 · 批次 2(侧栏 + 命令面板)**
- ✅ 侧栏:条目 32px/衬 4px/圆角 4/gap 4/白字 14px/图标 16px(4px 盒边距);激活与 hover 底 = light-1(#2b2b2b);列表容器衬 0 6px 8px;logo 行 44px(衬 8px 6px);顶部工具钮 28×28/圆角 4;Preview 徽章 = purple-200 底/purple-600 字/圆角 16/10px-600/衬 2px 4px(硬编码色移除,改令牌)
- ✅ Help 菜单结构对齐 n8n 顺序(条目 → About → "What's new" 分组)
- ✅ 命令面板:面板 700px/light-3 底/1px 边框/4px 圆角/--command-bar--shadow;**无遮罩变暗**(n8n 实测透明);输入行 48px(0 32px 0 16px,placeholder "Type a command or search...");分组结构重构 = Workflows(Create workflow+开)/Credentials(Create credential+开)/Executions + 上下文组置顶;分组标 12px tint-1;条目 40px,hover = --command-bar-item--color--background--hover
- 校验:build ✓ / vitest 22 ✓ / 5181 预览目视(面板开合、分组、样式)✓

**2026-07-18 · 批次 1(地基 + Overview 首屏)**
- ✅ 令牌地基:n8n-tokens.css 进入构建;字体资产本地化;body[data-theme=dark];20 个历史别名重定向到真令牌(声明位置修正到 body,规避 :root 解析陷阱);body 16px/1;--radius 真值 4px 生效
- ✅ KPI 条重写(整条面板/99px 格/6px 圆角外框/24px 数值/可点,附 flex-shrink 防压扁修复)
- ✅ Overview tab 行(14px/500,无整条下划线,激活橙 2px)
- ✅ 工具行(搜索/排序/漏斗钮 32px + inset 1px 环 + bg light-2)
- ✅ 工作流卡片(bg light-3/8px 圆角/16px 衬距/8px 卡距/标题 14px/500 白/meta 12px tint-1)、Personal 徽章(25px/12px 字)、行内 ⋮(28×28)、分页(28px 高/当前页橙描边 12px/600)
- ✅ 全局按钮(32px/0 12px/4px;primary=inset 橙环+投影;secondary=--button--*--secondary 令牌)
- 校验:vitest 22/22 通过;vite build 通过;5181 预览目视核对
- 待阶段五并排验收后才对每页盖"完成"章
