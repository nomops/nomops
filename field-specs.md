# 基线 1:1 复刻 — 阶段三:逐页字段级清单 (field-specs)

> 事实来源:http://localhost:5679/ (参考基线 2.30.4 stable, Community, dark)
> 取证时间:2026-07-17(阶段一 + 阶段三两轮实测)
> 用法:实现验收标准。每个控件的 类型/label/placeholder/默认值/选项/交互 均为实测原文;
> 标注 ⚠人工 的条目为本轮工具限制未能取证、需人工手测一次的残留项(全文仅 2 处)。

---

## 1. 全局壳

### 1.1 主侧栏
| 控件 | 实测细节 |
|---|---|
| Logo | 基线粉色 logo;折叠态隐藏文字 |
| `+` Add new item | 菜单:New workflow / New credential / New data table / New project(禁用+`Enterprise`徽章) |
| 搜索按钮 | 打开命令面板(见 1.2) |
| 侧栏开关 | 折叠(50px 图标列)↔ 展开(200px,实测 aside#sidebar) |
| 导航 | Overview(`/home`)、Chat+`Preview` 徽章(`/home/chat`) |
| 底部 | Templates(**外链** 对标站点+UTM)、Insights(图标带红点)、Help(子菜单)、Settings(子菜单) |
| Help 子菜单 | Quickstart(视频图标)/ Documentation / Forum / Course / Report a bug / About 基线 / 组标题 "What's new" / What's new 条目 / Full changelog / **Update (1 version behind)**(橙色感叹号) |
| Settings 子菜单 | Usage and plan / Personal / Users / Roles`New` / 基线 API / External Secrets / Environments / SSO / Security & policies / LDAP / Log Streaming / OpenTelemetry / Community nodes / Instance-level MCP`Preview` / Chat`Preview` / ―分隔― / Sign out |

### 1.2 命令面板
- 全局态:输入 placeholder `Type a command or search...`;分组 Workflows(Create workflow in Personal / Open workflow)、Credentials(Create credential in Personal / Open credential)、Data tables(Create data table in Personal / Open data table)
- 工作流上下文态:作用域徽标 `Workflow · <名称>`;分组 Recent:`Open <节点名>`(带节点图标,逐节点)

### 1.3 文档标题
`Workflows - 基线` 等;编辑器 `▶️ <名> - 基线`;执行中 `🔄 <名> - 基线`;兜底 `对标站点 - Workflow Automation`

---

## 2. 列表页族(Overview `/home/*` 与 Personal `/projects/:id/*` 同构)

> 实测:Overview 标题 "Overview"+副标 "All the workflows, credentials and data tables you have access to";
> Personal 变体标题 "Personal"+副标 "Workflows, credentials and data tables owned by you";
> Data tables 的 Overview CTA 会跳转到 Personal 页签(实测)。

### 2.1 Workflows 列表
| 控件 | 细节 |
|---|---|
| 主按钮 | `Create workflow` + caret 下拉:Create credential / Create data table |
| Search | placeholder `Search`(放大镜前缀) |
| Sort 下拉 | 选项(实测):`Sort by last updated` / `Sort by last created` / `Sort by name (A-Z)` / `Sort by name (Z-A)`;默认 last updated |
| Filters 漏斗弹层 | Tags → `Filter by tags` 多选;Status → 下拉 `All` / `Published` / `Unpublished`;复选框 `Show archived workflows` |
| Add folder | **未注册 Community 实测**:打开注册引导弹窗 "Get access to folders with registered community"(特性列表:Advanced debugging / Execution search and tagging / Folders;邮箱输入预填 owner 邮箱;注释 "Included features may change, but once unlocked, you'll keep them forever. More info";按钮 Skip / **Send me a free license key**) |
| 卡片 | 名称 / `Last updated X | Created <date>` / 共享数徽章(链条+数字) / `Personal` 徽章 / ⋮ |
| 卡片 ⋮ 菜单(实测) | Open / Share... / Favorite / Duplicate / Archive / Enable MCP access |
| Share... 弹窗(Community) | 标题 "Sharing";文案 "You can collaborate with others on workflows when you upgrade your plan.";**View plans**;X |
| 分页 | `Total N` + ‹ › + 页号(当前橙描边)+ 页大小下拉:`10/page`/`25/page`/`50/page`/`100/page`(默认 50) |

### 2.2 Credentials 列表
- 主按钮 `Create credential`+caret;Search placeholder `Search credentials...`;Sort/漏斗同上
- 卡片:品牌图标 / 名称 / `<类型名> | Last updated … | Created …` / 使用数徽章 / Personal / ⋮
- ⋮ 菜单(实测):**Open / Delete**(仅 2 项)
- **Add new credential 模态**:说明 "Select an app or service to connect to";可搜索下拉 placeholder `Search for app...`(展开=字母序类型全列表);**Continue**(未选禁用)
- **凭证编辑模态**(实测 OpenAI/DeepSeek 两例):
  - 头部:品牌图标 + 名称(可编辑)+ 类型副标 + **Save** + 垃圾桶(已保存时)+ X
  - Tab:Connection / Sharing / Details
  - Connection:顶部帮助条 "Need help filling out these fields? **Read our docs**";字段按凭证类型渲染(OpenAI:API Key*、Organization ID (optional)+帮助文本、Base URL 默认 `https://api.openai.com/v1`、Add Custom Header 开关;DeepSeek:API Key*(掩码 ••••)、Allowed HTTP Request Domains 下拉=`Specific Domains`、Allowed Domains=`https://api.deepseek.com`);字段 hover 控件:⋮ + `Fixed|Expression`
  - **连接测试**(打开已保存凭证自动运行):红色横幅 `⚠ Couldn't connect with these settings` + **More details** 链接 + 重试按钮(测试中转圈)
  - 底部注:"Enterprise plan users can pull in credentials from external vaults. **More info**"
  - Sharing:虚线框 "Upgrade to collaborate" + View plans
  - Details(已保存):Created / Last modified / ID 三行;未保存:空白
- 凭证类型全列表:见 `refs/node-types-reference.json` 的 credentials 字段 + `/types/credentials.json`

### 2.3 Executions 列表
- `Auto refresh` 复选框(默认勾选,橙色)+ 漏斗
- 表:全选框 / Workflow / Status / Started(`Jul 16, 16:54:24`)/ Run Time(`116ms`)/ Exec. ID / 试管图标(manual)/ ⋮
- 行态:Error=红叉+暗红行底;Success=绿勾
- 行 ⋮ 菜单与批量条:⚠人工(合成点击未弹出,需人工确认一次;预计 Delete/Retry)

### 2.4 Variables(Community 锁)
- Create variable 禁用;虚线框 "Upgrade to unlock variables" + `$vars` 代码字 + "Learn more in the docs." + **View plans**

### 2.5 Data tables
- 空态:虚线框 + "You don't have any data tables yet" + 说明 + **Create data table**
- **创建模态**(实测):`Data table name`*(placeholder `Enter data table name`);单选 `From scratch`(默认)/`Import CSV`;Cancel / Create(名称为空禁用)
- **详情页**(实测):面包屑 `Personal / Data tables / <名>` + ⋮(菜单:Rename / Import CSV / Download CSV / Favorite / Delete);右上 Search(带 ⓘ)+ **Add Row**(橙)+ **Add Column**
  - 网格:选择列 + 系统列 `id`、`createdAt`、`updatedAt`(日历图标)+ 表头 `+`(加列)+ 行首 `+`(加行);空态 "No rows";分页 `Total 0` + `20/page`(数据表默认 20)
  - **Add Column 弹层**:Name*(placeholder `Enter column name`)+ Type* 下拉:`string`(默认)/`number`/`boolean`/`datetime`(带类型图标)+ Add Column
  - **删除确认**:"Delete data table / Are you sure you want to delete the data table '<名>'? This action cannot be undone." Cancel/Delete

---

## 3. 工作流编辑器

### 3.1 顶栏
- 面包屑:`Personal / <名称>`(超长省略);`+ Add tag` → 变输入框 placeholder `Choose or create a tag`,下拉:`Type to create a tag` + 底部 `Manage tags`(眼睛图标)
- Tab:Editor / Executions / Evaluations
- `0 / 1` 发布计数;**Publish**(无可发布改动禁用)+ caret:Publish(⇧P)/ View timeline / Unpublish(⌘U)
- 历史图标 → History;`⋯` 菜单:Edit description / Duplicate / Download / Rename / Favorite / Import from URL… / Import from file… / Push to git(禁用)/ Settings / **Archive**(红)
- **Description 弹窗**(实测):说明 "Clear descriptions help other users and MCP clients understand the purpose of your workflow";textarea;Cancel/Save
- **Import Workflow from URL 弹窗**:输入 placeholder `Workflow URL`;**Import**/Cancel
- **Workflow settings 弹窗**:9 字段(见 manifest §7.1)

### 3.2 画布
- 空画布首屏:虚线 `+` 占位节点 + 文案 `Add first step…`;无触发器时**无** Execute 按钮,底栏仅 Logs
- **触发器面板**(实测 8 项,标题 "What triggers this workflow?" 副标 "A trigger is a step that starts your workflow"):
  1. Trigger manually — Runs the flow on clicking a button in 基线. Good for getting started quickly
  2. On app event — Runs the flow when something happens in an app like Telegram, Notion or Airtable
  3. On a schedule — Runs the flow every day, hour, or custom interval
  4. On webhook call — Runs the flow on receiving an HTTP request
  5. On form submission — Generate webforms in 基线 and pass their responses to the workflow
  6. When executed by another workflow — Runs the flow when called by the Execute Workflow node from a different workflow
  7. On chat message — Runs the flow when a user sends a chat message. For use with AI nodes
  8. Other ways... — Runs the flow on workflow errors, file changes, etc.
- **节点创建面板**("What happens next?"):搜索 placeholder `Search nodes...`;7 分类:AI / Action in an app / Data transformation / Flow / Core / Human review / Add another trigger;搜索结果=平铺列表(图标+名+描述,如 `Edit Fields (Set) — Modify, add, or remove item fields`);选中即插入节点并自动打开 NDV;AI 子面板见 manifest §7.4;**全部节点清单数据源:`refs/node-types-reference.json`(916 个,实测导出)**
- 节点状态(全实测):默认 / 选中(白描边)/ 执行成功(绿描边+绿勾徽章,连线变绿+`1 item` 标签)/ 参数改动未重跑(橙描边+橙三角)/ 错误(红三角)/ 触发器闪电标 / 副标题行(如 `manual`)
- 连线:`+`(线中插入)、IF 输出标 `true`/`false`、端点 `+`
- 便签 Sticky:右栏便签按钮一键创建;默认内容 `I'm a note\n\n**Double click** to edit me.\n[Guide]`;右键菜单:Edit sticky note(↵)/ **Change color** / Copy / Duplicate / Tidy up workflow / Select all / Clear selection / Delete;调色工具条:**7 色板 + 彩虹自定义色块**,下挂 垃圾桶/调色/⋯;选中灰描边
- 节点右键菜单 13 项(见 manifest §7.3)
- 控制:左下 fit/zoom±/(有历史)撤销/Tidy up 魔杖;底中 **Execute workflow**(试管,副行 `from <触发器名>`,多触发器时)+ caret;含 Chat Trigger 时 **Open chat/Hide chat**;执行后出现 **Clear execution**
- 底部面板:Chat(Session id + ↺ 重置 + 输入 placeholder `Type message, or press 'up' for previous one` + 发送)| **Logs**:
  - 空态 "Nothing to display yet. Execute the workflow to see execution logs."
  - 执行后(实测):左树 = `Success in 420ms` 摘要 + 逐节点行(图标+名,选中高亮);右详情 = `<节点名> Success in 60ms` + `Input|Output` 切换 + ⋯ + 收起;OUTPUT 子面板 = 搜索 + 视图三连(schema/table/json 图标)+ `1 item` + 数据表格

### 3.3 NDV
- 框架:三栏模态;顶部 节点图标+名 / `|||` 拖比例 / Docs↗ / X;两侧相邻节点 chip;底中 "💡 I wish this node would..."
- INPUT:无数据=`→| No input data` + **Execute previous nodes**;有数据=头部 搜索+`Schema|Table|JSON`;上游节点分组(名+⚡)、"No fields - node executed, but no items were sent on this branch"、折叠组 `Variables and context`;AI 子节点变体:`Mapping|From AI`
- OUTPUT:无数据=`|→ No output data` + Execute step + `or set mock data` 橙链 + 铅笔(edit output);有数据=绿勾ⓘ+搜索+视图三连+`1 item`+**pin 图钉按钮**(hover 数据区出现;pin 亦可经右键菜单 P);数据过时=⚠ 三角;JSON 视图带缩进导线+语法色+hover 复制按钮;Table 视图=列头+行
- Settings tab(通用):Always Output Data / Execute Once / Retry On Fail 开关;On Error 下拉(`Stop Workflow`);Notes;Display Note in Flow? 开关;底注 `<Node> node version X (Latest version: Y)`
- 参数控件类型(实测样本):下拉(Mode=`Manual Mapping`)、**拖放集合区**(`Drag input fields here or Add Field` 虚线框;行=name/type 下拉 `T String`/value,hover 出 ⋮⋮ 拖手柄+垃圾桶)、开关(Include Other Input Fields)、`Options + Add option` 折叠集合、代码/表达式框(fx)、资源定位器(Model=模式下拉+值输入)、凭证选择器(`No credentials yet` + **Set up credential**)、Import cURL 按钮(HTTP)、条件组(IF)
- **每个节点的完整参数 schema 以 `/types/nodes.json` 为准(916 节点已导出摘要;实现时直接消费全量 JSON)**

### 3.4 表达式系统(实测)
- Fixed|Expression 切换(字段 hover 工具条:FocusPanel 图标 / ⋮ / 切换)
- Expression 态:`=` 左 gutter;**Result 预览面板**(`Result` + `Item N` pager ‹›;未执行时值区显示 `[Execute previous nodes for preview]`;字段下内联预览可显示 `undefined`)+ Tip 行 "**Tip:** Anything inside `{{ }}` is JavaScript. **Learn more**"
- Focus Panel(右抽屉):Tab `Setup | <参数名>`;行头 `<参数名> <节点名>` + ▶ + X;提示 "ⓘ Execute previous node for autocomplete";大编辑区;Fixed|Expression
- ⚠人工:自动补全弹层($json 成员列表 UI)——CodeMirror 补全无法被合成键盘事件触发,需人工手测截图一次(数据源与触发规则已知:输入 `{{ $` 或 Ctrl+Space)

### 3.5 History
- Versions tab:版本条目(黄点+标题+`<作者>, <Jul 17 at 23:19:40>`+⋮)、折叠组 `N versions`、脚注 "Version history is limited to 1 day / **Upgrade plan** to activate full history"
- **Actions 下拉(实测)**:Publish version / Clone to new workflow / Open version in new tab / Download
- **Publish Timeline tab(实测)**:空态 "This workflow has no publish history yet."
- 只读画布:斜纹底

### 3.6 Executions tab / 执行详情 / Debug
- 空态:左 "No executions found";右 "Nothing here yet" + 折叠 "Which executions is this workflow saving?"
- 详情:顶条 时间标题 + **Copy to editor** + 垃圾桶;只读斜纹画布快照
- **Debug 路由实测**:`/workflow/:id/debug/:execId` 在未注册 Community 下**重定向回 /home/workflows**(Advanced debugging 属注册特性)

### 3.7 Evaluations tab
- 注册门:标题 "Test your AI workflow over multiple inputs" + More info;左视频位;右虚线框 "Register to enable evaluation" + **Register instance**

---

## 4. Chat 应用
- 壳:专属侧栏(New chat / Personal agents / Workflow agents / 历史组 `Today` / 底部 Settings)
- **Select model 级联(实测)**:搜索 `Search...`;顶部 Personal agents ›、Workflow agents ›;provider 列表(各带 › 子菜单):OpenAI / Anthropic / Google / Azure (API Key) / Azure (Entra ID) / Ollama / xAI Grok / Groq / DeepSeek / Cohere / Mistral Cloud / NVIDIA Nemotron / AWS Bedrock / Vercel AI Gateway / OpenRouter
- composer:紫色提示条 "ⓘ Please **select a model** to start a conversation";输入 placeholder `Select a model`;`+ Tools`(**未选模型时点击无响应=禁用**);回形针/麦克风/橙色↑发送
- Personal Agents 页:空态 + **+ New Agent**
- 会话消息流/流式回复:需配置 provider key,复刻期以 Chat API 联调时人工验收
- **Chat 设置页**:Enable Chat 开关;Providers 表 15 行(⋮ hover 提示 `Edit provider`);**Configure <Provider> 弹窗(实测 OpenAI)**:Enable OpenAI 开关 / Default credential 下拉(`Select`)/ Use Responses API 开关+说明("Disable this if your OpenAI credential uses a custom base URL that doesn't support the Responses API (e.g. Gemini via OpenAI compatibility layer)")/ Context window (messages) 数字步进器(默认 20,−/+)+说明("Number of previous interactions (message and reply pairs) to include as context for the model (default: 20)")/ Cancel/**Confirm**

---

## 5. Settings 字段清单(阶段一已录基础,阶段三补差)
- Usage and plan:**Enter activation key 弹窗(实测)**=输入 placeholder `Activation key` + Cancel/**Activate**
- Personal:Theme 下拉选项(实测):`System default` / `Light theme` / `Dark theme`
- Users:**Invite new users 弹窗(实测)**:Upgrade 横幅;`New User Email Addresses`*(placeholder `name1@email.com, name2@email.com, ...`);`Role`* 下拉(默认 `Member`;Admin 为升级项);**Create invite link**
- Roles:Instance roles / **Project roles(实测)** 两 tab 同为 Enterprise 锁(三卡图形+Upgrade to Enterprise+Learn more↗+Upgrade)
- Instance-level MCP:**Connection details 弹层(实测)**:`OAuth | Access token` 分段切换;`Server URL` 只读值 `http://localhost:5678/mcp-server/http` + 复制按钮;Connected clients tab=表(Client Name/Connected At)+空态 "No OAuth clients connected / Clients that connect via OAuth will show up here / **See connection instructions**";OAuth settings tab=`Allowed OAuth Redirect URLs` + **Save Redirect URLs**
- 其余页(External Secrets/Environments/SSO/LDAP/Log Streaming=锁;Security & policies/OpenTelemetry/Community nodes=全字段)见 manifest §8,字段原文已录

---

## 6. 系统页(实测)
- **404**(任意未知路由):⚠ 大三角图标 + "Oops, couldn't find that" + "404 Error" + 橙色 **Go back**
- **entity-not-found/workflow**:卡片 + ⓘ 圆圈图标 + "Workflow not found" + "We couldn't find the workflow you were looking for. Make sure you have the correct URL." + **Go to overview**(次要按钮)

---

## 7. 数据源(实现直接消费)
| 数据 | 来源 | 状态 |
|---|---|---|
| 节点类型全量(NDV 参数 schema) | `GET /types/nodes.json`(16.6MB,916 节点) | 摘要已入库 `refs/node-types-reference.json`;全量按需重拉 |
| 凭证类型全量 | `GET /types/credentials.json` | 同上方式拉取 |
| 设计令牌 | `design-tokens.css` | ✅ 已 100% 等值验收 |
| 分类计数(实测) | AI 423 / Communication 119 / Development 125 / Core Nodes 95 / Data & Storage 72 / Marketing 61 / Productivity 54 / Sales 48 / Utility 27 / HITL 16 / Finance 15 / Misc 15 / Analytics 14 / Developer Tools 3 | — |

---

## 8. 残留项(全清单)
| # | 项 | 状态 |
|---|---|---|
| 1 | 表达式自动补全弹层 UI | ⚠人工(工具限制,一次手测) |
| 2 | Executions 行 ⋮ 菜单与批量操作条 | ⚠人工(同上) |
| 3 | 鉴权页组(signin/signup/setup/forgot/change-password) | 🔒等你决定(需登出或提供密码) |
| 4 | Chat 会话消息流态 | 延后到 Chat 模块联调时人工验收(需 provider key) |
| 5 | 节点创建面板其余 5 个分类的子层级视觉 | 结构=数据驱动(nodes.json);面板骨架已取证;实现后并排验收时逐分类比对 |
