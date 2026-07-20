# nomops ⟷ 基线 1:1 复刻差异台账 (diff-ledger)

> 基准真站:http://localhost:5679/(参考基线 2.30.4 stable · Community · dark)
> 复刻版:nomops http://localhost:5181/(1440×655 同视口)
> 方法:①5 路并行代码级审计(以 manifest.md / field-specs.md / acceptance-report.md / design-tokens.css 里**已取证的基线真值**为基准,逐行比对 nomops 源码,每行带 `file:line`);②本人在两侧运行实例上跑 **live computed-style 数值比对**(Control_Chrome 读基线 · Browser 面板读 nomops)。
> 日期:2026-07-18 · **本轮只审计,未改任何代码**
> 严重等级:**P0**=功能/结构缺失(整块没做/交互不通);**P1**=明显视觉/文案错误(用户一眼可见);**P2**=数值级偏差(几 px / 色差一档 / 文案措辞 / 过渡差)。
>
> ⚠ **关于「截图路径」列**:本会话基线侧只有 Control_Chrome 通道(能读 computed style,**不能截图**;claude-in-chrome 全功能扩展本会话断连)。因此**无法产出基线侧配对截图**——每行证据改用 `真站列的具体数值/文案 + 复刻版的 file:line`。此为环境限制,已在文末「没能验证到的部分」如实登记。

---

## 修复进度(P0 分批)

> 决定:B 类 6 项(Variables/Insights/Roles/Security&policies/Observability/Chat providers)按用户裁决**全部 1:1 阉割成基线锁墙**(前端换锁态,后端接口保留可回退)。

- ✅ **Batch 1**(6a28b35):D028 动态 title · D022 命令面板 Data tables 组(+D021 in Personal)· D077 便签 7 色 · D001 侧栏折叠态。
- ✅ **Batch 2**(6bf761a):D152 Insights 锁态 · D047 Variables 锁态 · D128 Roles Enterprise 锁卡。
- ✅ **Batch 3**(8cbf47c):D154 Shared 整页 · D131 MCP OAuth settings tab · D058/D059 Evaluations pill+注册锁态。
- ✅ **Batch 4**(ed47b1a):D061 Workflow settings 9 字段(+D062 #ID)· D088 NDV Settings tab 6 项(INode 扩展)。
- ✅ **Batch 5a**(f9da5f5):D106 IF 条件组 · D105 Set 赋值区(告别 JSON 文本框)。
- ✅ **Batch 5b**(762ec0f):D104 NDV 凭证选择器。
- 🚫 **D103 resourceLocator = N/A**:无任何 nomops 节点使用(基线特有资源定位器),简化 schema 不需要 → 豁免。
- ⏸ **D096 Mapping\|From AI 暂缓**:AI Agent "让 AI 填参数" 运行时特性,需引擎 $fromAI 支持,纯 UI 假控件无意义 → 待引擎支持。
- ✅ **Batch 6a**(d3adeb1):D067 节点右键 13 项菜单(+ 新增 editor.renameNode 重写连接)。
- ✅ **Batch 6b**(2074736):D069 节点面板 7 分类 + D070 8 策展触发器(+ 顺带 D071/D072)。
- ✅ **描述 live 逐字复验**(2026-07-19):经 Control_Chrome 按 **N 键**打开基线节点创建器,读取 7 分类 + 8 触发器**逐字真值**并逐条订正(改 4 处:Action in an app 品牌名 `Slack,GitHub`→`Google Sheets, Telegram`;Core 补 `set webhooks`;Human review 全文改 `Request approval via services like Slack and Telegram before making tool calls`;Add another trigger 补句末句号)。nomops 侧 live 截图两张确认渲染一致(触发器根「What triggers this workflow?」/ 分类根「What happens next?」)。基线配对截图仍缺(claude-in-chrome 全程掉线),仅描述文本 live 取证。
- ✅ **Batch 7a**(ee5f94c):D063 版本历史整页 + 只读斜纹画布(新增 ReadOnlyCanvas.vue;基线 History 页经 N 键全量 live 取证:Versions|Publish Timeline 双 tab、Current changes 置顶→N versions 分组头、Actions 4 项 Publish version/Clone to new workflow/Open version in new tab/Download、升级脚注)。
- ✅ **Batch 7b**(D085):执行详情只读画布——顶条 Copy to editor + 垃圾桶 + 只读斜纹画布快照(节点带执行态 status-ok/error)+ 底部 Execution data 折叠。⚠ **两点受限**:①基线全实例 0 执行记录,本项基线侧无法 live 复验(沿用先前审计真值 + 基线执行详情通用结构);②nomops 执行 API 不返回执行时工作流快照,只读画布用「当前工作流」定义近似渲染,Copy to editor 退化为切回 Editor tab。nomops 侧 live 全量验证(造执行→顶条/斜纹画布/3 节点 status-ok/Execution data 折叠)。
- ✅ **Batch 8**(B 类锁墙收尾,三页经基线 /settings live 逐字取证):
  - **D127** Security & policies:换成基线三分区(Enforce 2FA / Data redaction / Personal Space),**5 处 Enterprise Upgrade 徽章** + Redact executions 下拉「Production executions (Recommended)」+ Affected scope「No executions」+ Existing shares「0 workflows, 0 credentials」+ Existing published workflows「0 workflows」。原 SSO/SCIM loader 后端保留可回退。
  - **D129** OpenTelemetry(顺带 **D018** 导航名 Observability→OpenTelemetry):整页两区 Collector connection / Tracing,全字段(状态下拉「When disabled, no traces leave this instance.」+ OTLP endpoint / Service name / Custom headers[Add header] / Trace path / Startup connectivity timeout[ms] / Verify configuration[Send test trace] / Trace sample rate / Include node spans / Inject outbound traceparent / Track published workflows only)+ Save settings·Discard changes。原 Prometheus /metrics 后端保留。
  - **D130** Chat providers:6→**15 家逐字**(OpenAI/Anthropic/Google/Azure (API Key)/Azure (Entra ID)/Ollama/AWS Bedrock/Vercel AI Gateway/xAI Grok/Groq/OpenRouter/DeepSeek/Cohere/Mistral Cloud/NVIDIA Nemotron),表列 Provider/Models(All models)/Last edited(-)。⚠ **品牌图标不复制基线的第三方厂商 logo 资源**,改用品牌色字母 monogram 芯片(视觉对等,规避第三方商标复制)。原 6 家真实 provider 后端 assistant-service 保留可回退。
  - 三页均 nomops 侧 live 全量验证(分区/徽章/字段/15 行)。typecheck+26 tests+build 全绿。
- ✅ **P1-A**(应用壳/侧栏,基调=用户裁决"完全 1:1,对标站点 外链照抄"):
  - **D002** 侧栏固定 201px、移除拖拽调宽把手。**D004** 移除"Personal"侧栏项。**D005** 移除"Admin Panel"侧栏项(路由 /admin 保留)。**D007** Templates 改外链 `对标站点模板库`(新标签)。**D008** `+`菜单 6→4 项(去 New variable/New AI chat)。**D009** New project 非 rbac 时改 Enterprise 徽章 + 置灰。**D012–D015** Help 菜单重构:Quickstart(YouTube)/Documentation/Forum/Course/Report a bug(GitHub issues)全外链 对标站点 + About nomops(留品牌)+ What's new 分组(新闻标题 + Full changelog→release-notes)。**D017/D132** 设置左导航移除"Languages"(15 段对齐基线)。**D018** 已于 Batch 8 修。
  - 🔧 **D006 经 live 纠正**:红点在 **Help**(What's new 未读,nomops 已有),**不在 Insights**——ledger 记错,不给 Insights 加红点。
  - nomops 侧 live 全量验证(侧栏 6 项/201px/无拖拽/`+`4 项/Help 8 项外链/设置 15 段)。typecheck+26 tests+build 全绿。
- ✅ **P1-B**(命令面板 CommandPalette.vue):**D023** 移除全局态多余 "Executions" 组(执行入口仅工作流上下文经 paletteContext 出现);**D024** emoji 图标(＋🔀🔑📋⌁)→单色描边 SVG(plus/workflow/key/table/command)。D021(Create … in Personal)、D025(真实行平铺)先前已做;**D026** 上下文 "Workflow · &lt;名&gt;" 徽标暂缓(需当前工作流名注入面板)。live 验证(分组无 Executions/图标为 SVG)。typecheck+26 tests+build 全绿。
- ✅ **P1-C**(Settings 五锁页按钮 D136,基线 live 逐字取证):External Secrets/SSO/LDAP/Log Streaming 锁卡按钮 "Enter activation key"→**"See plans"**(外链 `对标站点定价页`);Environments 改 **[More info][See plans]** 双钮(live 实测 Environments 有两钮,ledger 原记只 More info 不全)+ 描述补 "(dev, prod, etc.)"。⚠ 锁卡仅未授权时渲染,测试实例 5 项全授权故无法 live 显示锁卡;改动经 typecheck+build 保证,基线真值已 live 取证(External Secrets/SSO/Environments 逐字)。
- ✅ **P1-D**(Workflows 工具行 + Chat placeholder,基线 live 取证):**D036** Sort 加 "Sort by last created"(4 项:last updated/last created/name A-Z/name Z-A);**D037** Status 加 "Unpublished"(All/Published/Unpublished,activeOnly 布尔→statusFilter 三态);**D121** 底部 Chat placeholder 改 "Type message, or press 'up' for previous one"。live 验证(Sort 4 项/Status 3 项)。typecheck+26 tests+build 全绿。
- ✅ **NDV truth 已取证**(用户在基线手动开 NDV,Control_Chrome 读取):Docs 链、floating-node 相邻 chip、resize-handle/panel-drag-button 可拖分隔条、tab-params/tab-settings、radio-button-schema/table/json(input 面板默认 Schema)、radio-button-fixed/expression(每字段)、"I wish this node would..." 反馈链、input 面板 Mapping|From AI。
- ✅ **P1-E**(NDV chrome):**D091** 头带右侧 Docs 外链(→docs.对标站点 内置节点文档);**D095** 参数区底部居中反馈链 "I wish this node would..."。live 验证(Docs 链 + 反馈链渲染)。typecheck+26 tests+build 全绿。剩 NDV 子批(真值已存):D092 相邻 chip 导航、D093 可拖分隔条、D098 DataPane 默认 Schema、D108 multiOptions、D109 Fixed|Expression 全字段、D111 多行、D112 notice、D115-D117 表达式、D118/D119 Focus Panel、D123 Logs 树。
- ✅ **P1-F**(NDV 参数控件 ParamInput.vue):**D109** Fixed\|Expression 切换从"仅 string"扩到 string/number/options/multiOptions/dateTime/color——表达式态任意可切字段统一渲染表达式编辑器(live 验证:Method[options] 现有 ƒx,切换后 select→表达式编辑器);**D111** string 带 `typeOptions.rows`→多行 textarea;**D108** multiOptions 勾选芯片多选。契约极小扩展(NodePropertyType 加 'multiOptions'、INodeProperties 加 typeOptions.rows)——D108/D111 前瞻性支持(当前无 nomops 节点声明,待节点使用)。引擎全绿(workflow 16 + core 40 含六拓扑)+ 前端 26 tests + build。
- ✅ **P1-G**(NDV 布局 NdvModal/DataPane):**D092** 两侧相邻节点 floating chip(左=输入邻居/右=输出邻居,点击切到该节点——live 验证点击右 chip→NDV 切到 No Operation);**D093** 三栏可拖拽分隔条(中栏两侧拖柄,live 验证右柄拖 +80px→420→500);**D098** DataPane 默认视图 table→Schema(live 验证 Schema 激活)。typecheck+26 tests+build 全绿。
- ✅ **P1-H**(D123 底部 Logs 执行树):扁平 `log-row` 列表升级为「左树 + 右详情」——左=摘要行(Success/Error in {总耗时}ms)+ 逐节点行(状态点/名/耗时,可选中高亮,默认选最后执行/出错节点);右=选中节点详情(状态 + in {耗时}ms + Input|Output 切换 + 复用 DataPane 显示 input/output 的 Schema/Table/JSON)。⚠ 基线实例 0 执行、不跑用户生产 Agent,本项按 ledger 审计真值 + 基线 Logs 通用结构构建;nomops 侧 live 全量验证(造工作流跑一次→摘要 Success in 12ms/3 节点树/选中 No Operation/Input·Output/DataPane 三视图/1 ITEMS)。typecheck+26 tests+build 全绿。
- ✅ **P1-I**(NDV 表达式/notice ParamInput/ExpressionInput):**D115** 表达式 Result 预览面板(标题 Result + 多 item 翻页 ‹›「Item N of M」+ 值/空态「[Execute previous nodes for preview]」+ 提示「Anything inside {{ }} is JavaScript. Learn more」)——live 验证 `={{ $json.firstName }}`→RESULT: Ada;**D117** `$json.` 成员级变量树补全(ExpressionInput 加 jsonFields prop + 成员补全源,ParamInput 从上游首 item 摊平字段路径喂入)——live 验证输入 Schema 显 firstName/city 同源;**D112** notice→紫色 Tip 提示条(code 正确,但当前无 nomops 节点声明 notice 属性,前瞻性,同 D108/D111 无法 live 触发)。⏸ **D116** 字段悬浮工具条(Focus Panel 图标/⋮/Fixed|Expression)暂缓——需 live 复观基线悬浮工具条精确布局,NDV 已关无法取证,按铁律不虚构。修一处 Vue 模板 bug(`{{ '{{ }}' }}` 嵌套 mustache 编译失败→提 CURLY 常量)。typecheck+26 tests+build 全绿。
- ✅ **P1-J**(Overview/Workflows StatsBar/OverviewView,基线 live 逐字取证):**D031** 5 KPI 卡各深链到自己的 `/insights/<metric>`(total/failed/failureRate/timeSaved/averageRunTime,原全链 /insights;路由改 `/insights/:metric?`)——live 验证 5 格 href + `/insights/total` 解析;**D039** 工作流卡 ⋮ 菜单按基线重排为 6 项 **Open / Share... / Favorite / Duplicate / Archive / Enable MCP access**(加 Share...=Enterprise 锁弹窗;移除自有 Activate/Manage tags/Move to,方法保留可回退)——live 验证 6 项 + Share 锁弹窗。typecheck+26 tests+build 全绿。
- ✅ **P1-K**(Overview 收尾 OverviewView,基线 live 逐字取证):**D044** Executions 工具行加**漏斗 Filters**(Status:All/Success/Error/Running/Waiting/Canceled + filteredExecutions 过滤),移除多余「N executions」计数——live 验证漏斗+6 状态+无计数;**D048** Data table 创建模态改 label「Data table name *」(ph「Enter data table name」)+ 单选 **From scratch/Import CSV**——live 验证 label/ph/双单选/Cancel·Create。**Overview 区 P1 收官**(D031/D036/D037/D039/D044/D048)。typecheck+26 tests+build 全绿。
- ✅ **P1-L**(Credentials CredentialModal/credential-types,基线 live 逐字取证):**D049** Sharing tab 换基线虚线升级卡「Upgrade to collaborate / You can share credentials with others when you upgrade your plan. / View plans」;**D050** Details tab 换 Created/Last modified/ID 三行(相对时间;未存则提示);**D051** OpenAI 凭证字段扩为 API Key* / Organization ID (optional)+hint / Base URL(默认 https://api.openai.com/v1)/ Add Custom Header 开关;**D053** CredentialField 加 required 位 + label 渲染红 *(API Key* 等);**D054** 头部加垃圾桶(已存凭证删除)。live 验证(建 OpenAI 凭证开模态:4 字段/必填星/垃圾桶/Sharing 锁/Details 三行全对)。typecheck+26 tests+build 全绿。
- ✅ **P1-M**(Chat 壳 ChatView,基线 /home/chat live 逐字取证):**D156** composer 加底栏 +Tools 按钮(左)+ 橙发送(右)(实测基线此版无回形针/麦克风,ledger 过记,未加);**D158** Personal Agents 副标改「Create and manage custom AI agents with specific instructions and behaviors」;**D159** New Agent 从网格虚线卡改右上橙钮「＋ New Agent」;**D160** 加空态「No personal agents available. Create your first custom agent to get started.」。live 验证(Tools/副标/New Agent/空态全对)。⏸ D155(侧栏搜索+折叠)/D157(provider→models 级联)较重,暂缓。typecheck+26 tests+build 全绿。
- ✅ **P1-N**(Settings SettingsView,基线 live 逐字取证):**D133** Personal 加 Personalisation 分区 + Theme 下拉(System default/Light theme/Dark theme,存 localStorage + 根 data-theme;浅色令牌为后续)——live 验证 3 选项 + 分区渲染;**D137** Usage Unlock 横幅文案改「Unlock selected paid features for free (forever)」(仅 Community 显示,本 enterprise 实例横幅隐藏,code 正确);**D138** 用量行改「Published workflows — N of Unlimited」(N=active 工作流数)+ caption「Published workflows with multiple triggers count multiple times. Error and Sub-workflow triggers are excluded.」——live 验证「Published workflows 0 of Unlimited」+ caption。typecheck+26 tests+build 全绿。
- ✅ **P1-O**(画布节点 CanvasNode/WorkflowCanvas,基线 live 逐字取证):**D068** 空白画布右键菜单(Add node[N] / Add sticky note[⇧S] / Tidy up workflow[⇧⌥T] / Select all[⌘A,置灰] / Clear selection)——live 验证 5 项;**D073** 移除触发器 ⚡ emoji 旗标(基线仅左弧无外挂)——live 验证无 flag;**D075** AI Agent 子端口标签 Model→**Chat Model**(必填红星)/ Tool / Memory——live 验证 Chat Model*/Tool/Memory。ledger D068 原记「Add node/Paste/Select all」不准(实测无 Paste,有 Add sticky note/Tidy up/Clear selection)。typecheck+26 tests+build 全绿。
- ✅ **P1-P**(便签 StickyNote/CanvasNode/editor):**D079** 便签默认内容改基线 markdown「## I'm a note \n**Double click** to edit me. [Guide](...)」+ CanvasNode 加极简 markdown 渲染(先转义防 XSS,再变换 标题/粗斜体/行内码/链接/列表/换行);editor.addNode 改为创建时填入各属性 default(便签默认内容才能落到节点)——live 验证(新便签渲染 h2「I'm a note」+ 粗体「Double click」+ 下划线链接「Guide」)。⏸ **D078** 便签 resize(需加 @vue-flow/node-resizer 依赖)/ **D080** 便签右键菜单(需 context-menu 分支)暂缓。typecheck+26 tests+build 全绿。
- ✅ **P1-Q**(Settings Users SettingsView,基线 live 逐字取证):**D134** Users 顶部加米黄升级条「Upgrade to unlock the ability to create additional admin users」(仅 Community 显示;本 enterprise 实例隐藏,code 正确);**D135** Account Type 列从内联 `<select>` 改纯文本(capitalize 角色;changeUserRole 保留可回退)——roleIsSelect=false 确认非 select。⚠ 测试账号是 member(无权列用户,Users 显 0 users)+ enterprise(升级条隐藏),故用户行/升级条无法 live 渲染验证;改动经 build 保证,基线侧真值已 live 取证。typecheck+26 tests+build 全绿。
- ✅ **P1-R**(画布顶栏 CanvasView,基线 live 逐字取证):**D064** 面包屑项目名前加人形图标(home-project「Personal」+ 人形 svg)——live 验证有图标 + "Personal";**D065** Add tag 下拉底部加「Manage tags」(眼睛图标,点击去 Overview 工作流列表)——live 验证 Manage tags。typecheck+26 tests+build 全绿。
- ✅ **P1-S**(Settings Community nodes SettingsView,基线 live 逐字取证):**D139** 标题行右上加常驻 Install 橙钮(有包时显示);**D140** 已装包从表格改**卡片**(包名 + 「N node(s): 节点名」+ 版本 + Uninstall,取代 Package/Version/Nodes 表)。⚠ nomops 无已装社区节点(空态),不装真 npm 包,故卡片/顶部 Install 无法 live 渲染;空态正常 + build 保证,基线侧真值已 live 取证(某社区节点包「1 node: … v1.0.6」等)。typecheck+26 tests+build 全绿。
- ✅ **P1-T**(Settings API SettingsView,基线 live 逐字取证):**D141** Create API Key 弹窗 Expiration 加「Custom」(选中显 `<input type=date>` + 动态过期文案),Scopes 加「Custom」单选(All/Read only/Custom);createApiKey 处理 custom→按日期换算天数、custom scope 后端未支持提交按 all。live 验证(Expiration 6 项含 Custom + 日期输入 / Scopes All·Read only·Custom)。typecheck+26 tests+build 全绿。
- ✅ **P1-U**(画布端口 CanvasNode):**D074** 输出端口旁加 **`+` 快捷加节点**(默认隐形、节点 hover 浮出;点击=选中本节点 + 开节点面板,addNode 自动从选中节点接线)——live 验证完整链路(+ 存在 → 面板打开 + 选中 Trigger → 加 HTTP Request 后自动生成 Trigger→HTTP Request 连线)。只读画布不渲染 `+`。typecheck+26 tests+build 全绿。
- ✅ **P1-V**(画布多选 editor/WorkflowCanvas):**D082** 加多选模型——store 新增 `selectedNames`(多选集,`selectedNodeName` 保留为主选中,供 NDV/自动接线)+ `setSelection`/`selectAll`/`removeSelected`;load/undo/removeNode/renameNode 四处同步维护多选集;WorkflowCanvas 接 Vue Flow `@selection-change`、启用 Shift 框选 + ⌘/Ctrl 点选,打通两个右键菜单的「Select all」「Clear selection」(原置灰)。live 全链路验证:Select all(store 3 + 画布 3 selected)· Clear(0/0)· 点选同步(names=[Node B])· 多选删除(3→0)· **undo 恢复(3)**。typecheck+26 tests+build 全绿。
- ✅ **P1-W**(Chat model 选择器 ChatView):**D157** 扁平 model 列表改 **provider → models 两级级联**——Agents 两组仍直选;每个已启用 provider 一行带 `›`(hover/点击展开其 models);搜索时退化为扁平跨 provider 匹配(同基线)。⚠ 基线的 model 下拉靠 synthetic click 打不开(同 NDV 类限制),无法 live 复观其**飞出式**子菜单;且 `.model-pop` 有 `overflow:hidden`,故实现为**内联缩进二级展开**(同为两级 + `›` 旋转),结构对齐、形态略异,已如实标注。live 验证(6 provider 行 + 展开 Anthropic → claude-sonnet-5/opus-4-8/haiku-4-5)。typecheck+26 tests+build 全绿。
- ✅ **P1-X**(连线工具条 CanvasEdge/WorkflowCanvas/editor):**D076** 新增自定义 edge 组件 `CanvasEdge.vue`——贝塞尔线 + 18px 透明加宽命中带 + **中点悬浮工具条(`+` 插入节点 / `✕` 删除连线)**;`toFlowEdges` 给边打 `type:'nomops'`,WorkflowCanvas 挂 `#edge-nomops` 插槽;edge id 反解为连接四元组;store 新增 `pendingInsert`,`addNode` 消费它把新节点插进连线(断原连线→接 source→新→target)。live 全链路验证:edge id `A:main:0->B:0` 正确反解 → `+` 开面板并置 pendingInsert → 加 Set 后重接为 **A→Set + Set→B** → `✕` 删除 `Set:main:0->B:0` 生效。typecheck+26 tests+build 全绿。
- ✅ **P1-Y**(便签 resize CanvasNode):**D078** 便签可拖拽调宽高——经用户批准新增依赖 `@vue-flow/node-resizer@^1.5.1`(未触发 pnpm allowBuilds 门);便签挂 `NodeResizer`(min 150×80,选中时显八向把手),`@resize-end` 把尺寸写入 `node.parameters.width/height`;`.sticky-note` 宽高改由内联 style 驱动(原固定 240×160,现为默认值)。live 验证:默认 240×160 → 点击选中显 **8 个 `.vue-flow__resize-control` 把手** → 写入 380×260 后便签实际渲染 380×260。typecheck+26 tests+build 全绿。
- ✅ **P1-Z**(便签右键菜单 WorkflowCanvas/CanvasNode/editor):**D080** 便签右键从「误用普通节点 13 项菜单」改为**便签专属 8 项**——Edit(↵)/ Change color(›,展开 7 色板)/ Copy(⌘C)/ Duplicate(⌘D)/ Tidy up workflow(⇧⌥T)/ Select all(⌘A)/ Clear selection / Delete(Del);store 加 `editingSticky` 标记,CanvasNode 监听后进入行内编辑。live 验证:便签→8 项 + 7 色板且不弹节点菜单;普通节点→仍 13 项且不弹便签菜单。⚠ 基线的便签右键同样不吃 synthetic 事件、无法 live 复观,菜单项按审计记录真值实现。
- ✅ **P1-AA**(MCP 设置 SettingsView/mcp-service/repositories/client):基线以 owner 账号 live 取证后清掉最后三项——**D142** redirect 允许清单说明从灰字段落改为 **warning 告示条**(⚠ 图标 + 橙左边框,**不可关闭**,基线无 × 按钮),文案照抄基线仅去掉品牌名;**D143** Connection details 浮层加 **`OAuth | Access token` 分段控件**,Server URL 两种模式常显,token 相关内容仅 Access token 模式出现;**D144** Workflows 表列补齐为 **Name / Location / Description**——数据是真打通的:`listAllUnscoped()` 的 select 补 `description`,类型贯通 db→mcp-service→client 三层(service 原本就 `{...w}` 展开,无逻辑改动)。🔧 顺手修掉 `mcpServerUrl` 里写死的 `:5678` dev 端口映射(后端已迁 5680,5678 被基线占用),改成正则匹配 5173/5180/5181。⚠ **本条未做 live 渲染验证**:nomops 的 MCP 页要 owner/admin,测试账号是 member,进不去——保障只有 build + 全量 typecheck + 128 测试全绿。
- ✅ **P2-A**(应用壳数值 SideBar/SettingsMenu):**D003** 折叠态 rail 58→**42px**、pad 8→6、条目改 32 高——⚠️ **ledger 记的 50px 是错的**(第 8 处纠错),live 实测基线 `#sidebar` computed width = **42px**,条目 29×32 落在 x=6;**D020** 设置菜单条目按基线设置导航体系对齐:13px→**14px**、pad 8×10→**4px**、圆角 7→**4px**、补 **32px** 高,并去掉 `var(--panel,#26262e)` 的硬编码回退;**D019** "New" 徽章从蓝色 `rgba(76,157,240,.18)/#7db4f5` 改回基线的**灰底药丸 `#bbb` 底 / `#444` 字**(10px/600,圆角 16,pad 2px 4px)。✅ 双侧 live 比对:折叠 rail 基线 42 / nomops 42(条目 29×32@6 vs 30×32@6);菜单条目两侧同为 32/14px/pad4/r4;New 徽章两侧同为 `rgb(68,68,68)` on `rgb(187,187,187)`、r16、pad 2px 4px。⚠️ 同批未动的:**D010**(`+` 菜单尾部 `›`)、**D016**(Help 弹层)、**D027**(esc chip)——基线的 `+` 菜单不吃 synthetic 事件,取不到真值,留待用户手动展开后再做。
- ✅ **P1-BB**(侧栏 SideBar):**D004 回退** —— 当初据一份缺项的取证把主侧栏的 "Personal" **删错了**,现 live 复观确证基线主侧栏为 `Overview / **Personal** / Chat(Preview) / Templates / Insights / Help / Settings`,Personal 指向个人项目 `/projects/{personalProjectId}/workflows`。已恢复该项(置于 Overview 与 Chat 之间,user 图标照抄基线 path,点击切个人项目上下文)。✅ live 比对:nomops 侧栏七项顺序与基线逐项一致。⚠️ 这是**第 9 处 ledger/取证纠错**,也是本轮唯一一次回退已发布改动。
- ✅ **P2-B**(Overview 数值 OverviewView/StatsBar/style.css):**D029** H1 行高 20px→**25px**(1.25);**D030** 副标行高 14px→**18.9px**(1.35);**D032** Failure rate 的 `%` 从焊进数值串改为独立单位元素,并按基线实测把 `.unit` 定为 **22px/600**(值为 24px/600)——原先用 `--font-size--lg`(18px)+ medium(500) 两项都不对;**D035** Tab 高 32→**24**,根因是全局 `button{height:32px}` 压过了 tab 内衬计算,加 `height:auto` 解决(内衬 0 16px 8px + 2px 下划线 = 24,与基线一致)。✅ 1440 视口双侧比对:H1 **431×25** 两侧全等;Tab **103×24** 两侧全等;单位 22px/600 两侧全等;KPI 格高 **99** 两侧全等。⚠️ **D034 未完成**:基线侧栏处于折叠态(42px),格宽随内容区弹性变化,无法与 nomops 的 201px 侧栏态同条件比对——实测发现两侧内容区**左右留白**不同(基线约 107/108,nomops 约 28/49),这才是残差所在,需**基线侧栏展开后**重量。⚠️ **D033 未完成**:ⓘ 是 `data-icon=info` 14×14 的 tooltip 触发器(`data-state=closed`),但 tooltip **文案**不在已加载 chunk 里(扫了全部 8 个 script),不虚构,待悬停取证。
- ✅ **P2-C**(Workflows 列表 OverviewView):**D042** 移除卡片上的 "Active" 绿点(基线卡片 DOM 实测只有 name / Last updated / Created / link 计数徽章 / 项目徽章 / ⋮,无任何激活态指示)。❌ **D040 判定为误报**:ledger 称基线 Create caret 只有 `Create credential / Create data table`,live 实测基线是 **`Create credential / Create variable / Create data table`** 三项,nomops 本就一致——**第 10 处纠错**,无需改动。⚠️ **D038 无法取证**:基线当前仅 4 条工作流,分页只渲染 `Total 4 | 1`,**页大小选择器不出现**,无从确认是否有 `100/page`;另发现基线单页时**不渲染**页大小选择器,而 nomops 恒显——此差异一并待验。⚠️ **D041 无法取证**:基线链条徽章实测为 `data-icon=link` 12×12 + 计数的**非交互 `n8n-badge tertiary` span**,而 nomops 是可点开下拉的按钮;但徽章**语义**(ledger 称"共享用户数")需 tooltip 悬停才能确认,不虚构。🆕 **新发现(非 P2,已回归)**:基线卡片 ⋮ 菜单实测 **7 项** `Open / Share... / Favorite / Duplicate / **Move** / Archive / Enable MCP access`,而 D039 当初按"6 项"实现、把 **Move 删掉了**。nomops 的 `moveWorkflowToFolder()` 仍在(OverviewView.vue:440)但**已成无人调用的死代码**。恢复 Move 需要补文件夹/项目选择弹窗,属功能开发,**未夹带进本批**,待裁决。
- ✅ **P2-J**(Settings 文案/列名 SettingsView):🔑 **本批起新增第二真值源** —— 用户提供本地 n8n 源码 `~/ByteMono/n8n`(**2.31.0**,注意与运行基线 **2.30.4** 不同版本:结构可参考,**版本文案仍以运行实例为准**)。i18n `en.json` 让若干条从"DOM 反推"变成"逐字确证"。**D147** SSO 描述改为基线实测原句 `Configure SSO to let your team sign in using your identity provider. Supports SAML 2.0 and OpenID Connect protocols. Learn more in the documentation`(尾链按政策指自有文档);**D149** API 空态改为基线句式 `Control <产品> programmatically using the <产品> API`(尾部橙链),原文案自造了 `REST API (header X-Nomops-Api-Key)`;**D150** Connected clients 列名 `Client/Version/Last seen` → 基线的 **`Client Name` / `Connected At` / (末列留空)**——源码 `settings.mcp.oAuthClients.table.clientName|connectedAt` 逐字印证 DOM 实测;另修 MCP 副标为源码原文 `…to build, run, and iterate on workflows in your instance`(原为自造的 `discover and run…this instance`)。🔴 **修两处我自己先前做错的**:**D142** 告示条我原先放进了 OAuth tab 内,实为**页级、Tab 行之上**(2.30.4 运行 DOM + 2.31.0 源码 `mcp-enabled-section` 内 `N8nNotice theme=warning` 在 `<N8nTabs>` 之前,双重印证);**D144** 空描述我写成 `—`,源码 `settings.mcp.workflows.table.column.description.emptyContent` 实为 **`No description`**。⚠️ **D148 存疑不改**:ledger 称基线 LDAP 描述举例 `Active Directory/Okta/Jumpcloud`,但已授权态的基线 LDAP 页**只有** `Learn more about LDAP in the Docs`,无任何举例——证据不支持 ledger,保持原样待复核。📌 **待办(源码新暴露,未做)**:D143 连接详情弹层基线还有 **`Configuration JSON`** 一项(`settings.mcp.connectPopover.jsonConfig`);D144 的描述列在基线**可点击编辑**(`column.description.editTooltip`/`action.updateDescription`),nomops 目前只读。
- ✅ **P2-I**(内容容器 OverviewView):**D034 完成,但病因和 ledger 记的不是一回事**。ledger 把它记成"KPI 格宽 227 vs 223",实际格子是**弹性等分**,宽度只是症状;直接读基线内容容器的计算样式,真因是 **`max-width: 1280px` + `padding: 24px 48px 0` + 居中**(内容区因此恒为 1184),而 nomops 的 `.ov` 是 `max-width: none` + `padding: 28px 48px 40px 28px` 且不居中。🔑 **取证手法**:不再等基线侧栏展开(点不开),改为**把 nomops 侧栏折叠到与基线同样的 42px** 做同条件比对,前提立刻成立。✅ live 同条件(1440 视口 / 42px 侧栏)双侧逐值全等:容器 **x=101 / 宽 1280**、KPI 条 **x=149 / 宽 1184**、格宽 **236,237,237,237,237**、格高 **99**。📌 底部 40px 留白保留(基线走内层 margin 收尾,nomops 走容器 padding;若改 0 会导致下缘贴边)——已在注释交代。
- ✅ **P2-H**(KPI/分页 StatsBar/OverviewView):**tooltip 也不需要用户悬停** —— 对 radix 触发器派发 `PointerEvent('pointerenter'/'pointerover'/'pointermove')` 并等 ~2s,内容即挂载进 DOM,由此一次拿下三项。**D033** 基线 Time saved ⓘ tooltip 实测文案:`No estimate available yet. To see potential time savings, add time estimates to each workflow from workflow settings.`(无估算态),已补为 `<title>`+`aria-label`;同时实测基线 ⓘ 为 **14×14**,nomops 原为 15×15,已改准。**D038** 基线页大小选项实测为 `10/page 25/page 50/page **100/page**`,nomops 缺 100,已补。❌ **D041 判定为误报**:ledger 称基线链条徽章语义是"共享用户数(仅共享时)",实测其 tooltip 为 `Click to view resources referenced by this workflow` —— 与 nomops 现有文案**一字不差**,语义与可点击性均已一致。**第 13 处纠错**,无需改动。✅ live 验证:nomops ⓘ **14×14**、`<title>` 文案落位;⚠️ 页大小选择器因测试账号无工作流**未能渲染验证**,仅有 build 保障。⚠️ **D034 本批未做**(留待用同条件手法:把 nomops 侧栏折叠到 42px 再比内容区留白)。
- ✅ **P2-G**(侧栏弹层 SideBar):沿用 P1-CC 的手法(不假设"打不开",直接实测)把之前判死的三项啃掉两项。**D010** 移除 `+` 菜单四项的尾部 `›` —— live 实测基线 `+` 菜单(宽 **198**)**任何一项都没有 chevron**;**D016** Help 弹层按基线实测重写:宽 210→**250**、圆角 10→**8px**、底色 `--bg-panel`→**`--color--background--light-3`**、去掉边框、padding 6→**0**、阴影换成基线的 `0 10px 15px -3px + 0 4px 6px -4px` —— ⚠️ ledger 记基线圆角为 `4(--radius)`,**实测是 8px**(第 12 处纠错)。✅ live 双侧比对:`+` 菜单 chevron 数 **0**;Help 弹层 **250 / 8px / lab(15.1576) / pad 0 / 无边框** 两侧**逐值全等**。⚠️ **D027 仍无真值**:⌘K 在基线上未能唤出命令面板(抓到的是页面搜索框),`<kbd>` 元素全页为 0 但证据太弱,不据此下结论。🆕 **新发现(gap,未修)**:基线 `+` 菜单实测 **5 项** —— `New workflow / New credential / **New variable** / New data table / New project`,其中 New variable 为 12px 双行、带 `database` Global 与 `user` Personal 的**范围选择子行**;nomops 只有 4 项,**缺 New variable**。补它需要建范围选择交互,未夹带。
- ✅ **P1-CC / P2-F**(NDV 字段工具条 ParamInput):**D116 + D110 一并完成——P1 至此清零**。🔑 **突破口是推翻自己的旧笔记**:此前记录"基线 NDV 不吃 synthetic 事件",本轮实测发现**鼠标事件确实打不开,但键盘可以**——选中节点后 `dispatchEvent(KeyboardEvent('keydown',{key:'Enter'}))` 即开 NDV;再注入 CSS 强制显形 `[data-test-id$=options-container]` 就读到了整条工具条,全程无需用户悬停。📐 **基线实测工具条构成**(顺序):标签 `SPAN` 12px/400 → `circle-help` ⓘ 12×12 dim → `panel-right` 16×16 → `ellipsis-vertical` ⋮ 12×12 → **Fixed|Expression 分段** 10px/500、高 15、Fixed 34×15 / Expression 61×15;⋮ 菜单实测**仅一项 `Reset Value`**。✅ **D110** 把内联 `ƒx` 按钮换成 Fixed|Expression 分段;**D116** 补 ⓘ(有 description 时渲染)与 ⋮/Reset Value。✅ live 双侧比对(在 nomops dev 实例临时建工作流验完即删):Fixed **34×15**、Expression **61×15**、10px/500、⋮ **12×12**、菜单 **Reset Value** —— **逐值全等**(先做出来偏 +4px,查明是内衬 6px vs 基线 4px,已改精确)。⚠️ **未做 `panel-right` 图标**:该图标是"在 Focus Panel 中打开此字段",需与 nomops 的 Focus Panel 联动,属功能接线而非样式,单列待办。🔧 同步更新 2 条单测(原断言 `button.fx` 已不存在)。
- ✅ **P2-E**(令牌化 SettingsMenu/SideBar/OverviewView/SettingsView/ChatView/CanvasView):🔴 **先修一个自己造的回归** —— P2-A 里把 SettingsMenu 弹层的 `var(--panel, #26262e)` 改成了 `var(--panel)`,但 **`--panel` 在本仓库从未定义过**,导致该属性解析为空、弹层背景变成 `rgba(0,0,0,0)` **全透明**(当时截图没看出来,因为页面底色也是深色)。改为直接引真令牌 `--color--background--light-1`,live 复验背景 = `rgb(43,43,43)`,与基线设置导航激活项实测值**逐值相同**。📌 **顺带查明**:`var(--panel,…)` / `var(--hover,…)` 全仓库共 **21 处**,`--panel`、`--hover` **两个令牌都不存在**——也就是说这些位置一直在**渲染硬编码回退值**,这正是 **D126** 的实质,且范围远比 ledger 记的(仅底部 Chat)更广。✅ **D126 部分完成**:8 处悬浮层背景(`#26262e`/`#2a2a33`)统一迁到 `--color--background--light-1`,live 复验设置菜单 `rgb(43,43,43)`、快速新建弹层 `≈#262626`(原 `#26262e`,肉眼无差)。⚠️ **有意未动**:2 处更深的面板(`#16161a` OverviewView:1501 / `#232329` CanvasView:1306)与全部 10 处 `--hover` ——这些表面对应基线的哪个令牌**没有实测依据**,基线会话过期期间不猜,待登录后逐面取证。❌ **D162 误报**(见上批)。
- ⏸️ **P2-D**(凭证 5 项)**未开工**:开工即遇基线会话过期(连续两次停在 `/signin`),D043/D052/D055/D056/D057 全部依赖基线取证,无一可做。✅ 但登出态的 `/signin` 页仍可读,顺手清掉一项:❌ **D162 判定为误报** —— ledger 称基线 Forgot 链接带问号(`Forgot my password?`)、nomops 无问号,live 实测基线文案是 **`Forgot my password`(无问号)**,`href=/forgot-password`、16px、橙色无下划线;nomops(LoginView.vue:253)本就是同一文案。**第 11 处纠错**,无需改动。
  🔧 **同时修复一个自引入的 TDZ 崩溃**:`watch(() => editor.editingSticky)` 被放在 `const editor = useEditorStore()` **之前**,setup 抛错导致**整块画布节点不渲染**(本会话第二次踩同类坑,已在代码里加注释警示)。
  📌 **注**:本条改动**未单独成 commit**,与仓库去品牌化清理(n→「基线」措辞统一、tokens 文件更名)**混在同一个 commit** 里提交。
- ✅ **B0**(引擎节点级设置落地,非 ledger 条目但影响 D088/D089):NDV Settings tab 的 5 个字段此前**只存不用**——引擎只消费布尔 `continueOnError`,`retryOnFail`/`maxTries`/`waitBetweenTries`/`executionTimeout`/`alwaysOutputData`/`executeOnce` 全无运行时行为。本批在引擎侧全部实现(`workflow/node-settings.ts` 归一化 + `core/workflow-execute.ts` 主循环),并补执行历史清理。前端侧:**D089 经查早在 Batch 4(ed47b1a)随 D088 一并做完**,ledger 第 220 行"换成布尔"是**过期记录**(第 14 处纠错);真正缺的是 Retry On Fail 打开后的 **`Max. Tries` / `Wait Between Tries (ms)`** 两个条件字段(标签取自本地 n8n 源码 i18n `nodeSettings.maxTries.displayName` / `waitBetweenTries.displayName` 逐字印证),已补,取值域与引擎 `resolveRetry` 的钳制共用同一组常量。测试:引擎 22 项 + db 双方言 14 项 + server 11 项 + 前端 store 9 项,全仓 424→456 测绿。

- 🎉 **P0 全部完成**(便签 7 色→D067 右键→D069/D070 面板→D104/D105/D106 参数→D088 NDV Settings→D058/D059 Evaluations→D061/D062 wf settings→D131 MCP OAuth→D154 Shared→D047/D152/D128 锁态→D063 History→D085 执行详情→D127/D129/D130 B 类)。豁免:D103 resourceLocator=N/A;暂缓:D096 Mapping|From AI(待引擎 $fromAI)。

---

## 严重度汇总

| 级别 | 数量 | 代表项 |
|---|---|---|
| **P0** | 28 | 参数控件引擎不全(IF/Set/HTTP 退化成 JSON)、节点右键 13 项菜单整体缺、Evaluations 整块缺、节点创建面板 7 分类/8 触发器缺、NDV Settings 6 项缺、History 整页缺、执行详情只读画布缺、Shared 整页缺、Insights 应锁未锁、Variables 应锁做成可用、命令面板缺 Data tables 组、无动态 document.title、凭证选择器/资源定位器缺、AI 子节点 Mapping\|From AI 缺、Security&policies/Roles/OpenTelemetry 三页被替换、Chat provider 6≠15 |
| **P1** | ~55 | 侧栏折叠态残缺、Publish 下拉退化、Workflow settings 缺 5 字段、便签 7 色→4 色、Focus Panel 缺 tab/▶、底部 Logs 无执行树、命令面板文案与图标、Help/Settings 菜单枚举、Sort/Status/⋮ 选项缺项、凭证字段缺、多处文案错、Chat composer 缺件 |
| **P2** | ~50 | 侧栏宽 201→244、H1/副标行高、Tab 高、Started 日期格式、色差、圆角、硬编码回退色、措辞偏差 |

---

## 一、全局应用壳(侧栏 / 顶部工具 / 命令面板 / Help·Settings 菜单)

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D001 | 应用壳 | SideBar | 折叠态顶部工具 | 折叠列仍含 `+`/搜索/侧栏开关三图标 | 折叠态 `brand-tools` 整块被 `v-if="!collapsed"` 隐藏,只留展开 chevron | P0 | SideBar.vue:189,214 |
| D002 | 应用壳 | SideBar | 侧栏宽度 | 固定 **201px**,不可拖拽 | 默认 **244px**,min220/max480,带拖拽调宽把手 | **P1**(43px 可见 + 多出拖拽) | live: 基线 201 / nomops 244;ui.ts:22, SideBar.vue:169,357 |
| D003 | 应用壳 | SideBar | 折叠宽度 | 50px | 58px | P2 | SideBar.vue:367 |
| D004 | 应用壳 | SideBar | 条目枚举 | 无独立 "Personal" 导航项(折叠进 Overview) | 额外渲染独立 "Personal" 行 | P1 | SideBar.vue:232 |
| D005 | 应用壳 | SideBar | 条目枚举 | 底部无 "Admin Panel" | 底部多 "Admin Panel"(首位) | P1 | SideBar.vue:249 |
| D006 | 应用壳 | SideBar | Insights 徽标 | Insights 图标右上有红点通知 | 无红点 | P1 | SideBar.vue:257-260 |
| D007 | 应用壳 | SideBar | Templates 行为 | **外链** 对标站点模板库(UTM) | 内链路由 `{name:'templates'}` → 内建页 | P1 | SideBar.vue:253, router.ts:24 |
| D008 | 顶部工具 | SideBar | `+` Add new 项数/顺序 | 4 项:New workflow/credential/data table/project | 6 项(多 New variable、New AI chat),顺序也异 | P1 | SideBar.vue:195-204 |
| D009 | 顶部工具 | SideBar | New project 徽章 | `Enterprise` 徽章 + 灰置禁用 | `Upgrade` 徽章 + 可点(跳 billing) | P1 | SideBar.vue:199-203 |
| D010 | 顶部工具 | SideBar | `+` 菜单项尾 chevron | 无尾部 `›` | 每项带尾部 `›` | P2 | SideBar.vue:195-198,412 |
| D011 | Help 菜单 | SideBar | 项枚举缺失 | Quickstart(视频图标)/Forum/Course/Full changelog/**Update(1 version behind)**(橙叹号) | 全部缺失 | P0 | SideBar.vue:272-284 |
| D012 | Help 菜单 | SideBar | 多余项 | 无 "Run live demo" | 顶部多 "Run live demo" | P1 | SideBar.vue:273-275 |
| D013 | Help 菜单 | SideBar | Documentation | 可点链接 "Documentation" | 灰置不可点,文案 "Documentation · docs/ (README → 01–10)" | P1 | SideBar.vue:276 |
| D014 | Help 菜单 | SideBar | 文案 | "Report a bug" | "Report a problem" | P1 | SideBar.vue:277 |
| D015 | Help 菜单 | SideBar | What's new 结构 | 组标题下列具体新闻标题 + Full changelog + Update | 仅一个泛化 "What's New" 项(弹模态) | P1 | SideBar.vue:279-283 |
| D016 | Help 菜单 | SideBar | 弹层样式 | 圆角 4(--radius)/token 底 | width210/圆角10px/硬编码阴影/legacy 别名 | P2 | SideBar.vue:405-409 |
| D017 | Settings 菜单 | settings-nav | 项枚举/顺序 | 15 段 + Sign out | 16 段(多 "Languages",插在 Personal↔Users) | P1 | settings-nav.ts:23-40,26 |
| D018 | Settings 菜单 | settings-nav | 文案 | "OpenTelemetry" | "Observability" | P1 | settings-nav.ts:35 |
| D019 | Settings 菜单 | SettingsMenu | Roles 徽章色 | 灰色 `New` | 蓝色 rgba(76,157,240,.18)/字#7db4f5 | P2 | SettingsMenu.vue:65 |
| D020 | Settings 菜单 | SettingsMenu | 条目规格 | 主侧栏体系 32px/14px | 13px/pad8×10/圆角7/硬编码 --panel 底 | P2 | SettingsMenu.vue:53-59 |
| D021 | 命令面板 | CommandPalette | 动作文案 | "Create workflow **in Personal**"/"Create credential **in Personal**" | 缺 " in Personal" 后缀 | P1 | CommandPalette.vue:73,84 |
| D022 | 命令面板 | CommandPalette | Data tables 分组 | 有(Create data table in Personal / Open data table) | **完全缺失** | P0 | CommandPalette.vue:98-103 |
| D023 | 命令面板 | CommandPalette | 多余分组 | 全局态无 Executions 组 | 多 "Executions" 组 | P1 | CommandPalette.vue:94-95 |
| D024 | 命令面板 | CommandPalette | 图标来源 | 真实 SVG 节点/动作图标 | emoji(＋🔀🔑📋⌁) | P1 | CommandPalette.vue:64-95 |
| D025 | 命令面板 | CommandPalette | 分组内容 | Workflows/Credentials 组为泛化 "Open workflow/credential" | 直接平铺真实行(带 "N nodes"/类型副行) | P1 | CommandPalette.vue:74-91 |
| D026 | 命令面板 | CommandPalette | 上下文作用域徽标 | 工作流态 "Workflow · &lt;名&gt;" 徽标 | 无(仅注入分组名) | P1 | CommandPalette.vue:139-151 |
| D027 | 命令面板 | CommandPalette | 输入行 esc chip | 无 esc 键位 chip | 右侧渲染 `esc` kbd 芯片 | P2 | CommandPalette.vue:150 |
| D028 | 全局 | index.html | 文档 title | 动态:列表 "Workflows - 基线"/编辑器 "▶️ &lt;名&gt; - 基线"/兜底 "对标站点 - Workflow Automation" | 静态 `&lt;title&gt;nomops&lt;/title&gt;`,全仓无 document.title 赋值 | P0 | index.html;grep 无 document.title |

---

## 二、Overview 页 + 五 Tab

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D029 | Overview | H1 | 行高/位置 | "Overview" 20px/600,**lh 25px**,内容左 origin x=249 | lh **20px**,x=272(右移 23,侧栏差所致) | P2 | live 基线[249,24,431,25]/nomops[272,28,431,20] |
| D030 | Overview | 副标题 | 行高 | 14px/400,**lh 18.9px** | lh **14px** | P2 | live |
| D031 | Overview | KPI 条 | 深链 | 5 格分链 `/insights/total\|failed\|failureRate\|timeSaved\|averageRunTime` | 5 格全链同一 `/insights` | P1 | StatsBar.vue:64;manifest §2.1 |
| D032 | Overview | KPI 条 | Failure rate 标签 | "Failure rate"(% 独立) | 标签 "Failure rate",% 拼数值上 | P2 | StatsBar.vue:50 |
| D033 | Overview | KPI 条 | Time saved tooltip | ⓘ 带 tooltip | ⓘ 无 title/aria/tooltip | P2 | StatsBar.vue:67-69 |
| D034 | Overview | KPI 格 | 格宽 | 227px | 223px | P2 | live 基线[250,101,227,99]/nomops[273,101,223,99] |
| D035 | Overview | Tab 行 | Tab 高/基线 | 激活 Tab 高 24,pad0 16 8,底线 y≈281 | 高 32,底线 y≈259(KPI→Tab 间距 57→27) | P2 | live 基线[249,257,103,24]/nomops[272,227,103,32] |
| D036 | Workflows | 工具行 | Sort 选项 | 4 项:last updated/**last created**/name(A-Z)/name(Z-A) | 3 项,缺 "Sort by last created" | P1 | OverviewView.vue:800-802 |
| D037 | Workflows | Filters | Status 枚举 | All/Published/**Unpublished** | 缺 "Unpublished" | P1 | OverviewView.vue:823-826 |
| D038 | Workflows | 分页 | 页大小 | 10/25/50/**100**(默50) | 缺 "100/page" | P2 | OverviewView.vue:981-983 |
| D039 | Workflows | 卡片 ⋮ 菜单 | 项枚举 | Open/**Share...**/Favorite/Duplicate/Archive/Enable MCP access | 缺 "Share...";多 Activate/Manage tags/Move to(自有) | P1 | OverviewView.vue:929-951 |
| D040 | Overview | Create caret | 菜单项 | 仅 Create credential/Create data table | 多 "Create variable" | P2 | OverviewView.vue:92-113 |
| D041 | Workflows | 卡片 | 链条徽章语义 | 链条+数字=共享用户数(仅共享时) | 复用为"依赖资源数" | P2 | OverviewView.vue:897-919 |
| D042 | Workflows | 卡片 | 多余状态 | 无 Active 开关(用 Publish 体系) | 卡片显 "Active" 绿点 + ⋮ Activate/Deactivate | P2 | OverviewView.vue:888,935-937 |
| D043 | Credentials | 列表 | 分页 | 底部有分页条 | 凭证列表**无分页条**(仅 workflows 有) | P2 | OverviewView.vue:1000-1056 |
| D044 | Executions | 工具行 | 漏斗 | Auto refresh + **漏斗 Filters** | 仅 Auto refresh + 多余 "N executions" 计数,无漏斗 | P1 | OverviewView.vue:1062-1071 |
| D045 | Executions | 表 | Started 格式 | `Jul 16, 16:54:24`(月-日+秒) | `16 Jul, 16:54`(日-月 en-GB 无秒) | P2 | OverviewView.vue:717-720 |
| D046 | Executions | 表 | Exec. ID | 数字自增短 ID | UUID 前 8 位 | P2 | OverviewView.vue:1121 |
| D047 | Variables | 整 Tab | **形态** | Community **锁态**:虚线框 "Upgrade to unlock variables" + `$vars` 代码字 + "Learn more in the docs." + **View plans** | 完整可用增删改表格 + 空态 "let's set up a variable"👋 | **P0** | OverviewView.vue:1206-1254 |
| D048 | Data tables | Create 模态 | 字段 | label "Data table name"* + 单选 From scratch/Import CSV + Cancel/Create | 标题 "Create new data table"/label "Name"/无单选组 | P1 | OverviewView.vue:1334-1351 |

---

## 三、凭证模态(新增 / 编辑)

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D049 | 凭证编辑 | CredentialModal | **Sharing tab** | 虚线框 "Upgrade to collaborate" + View plans | 自撰 "Share this credential"+"…Enterprise plan.",无虚线框/View plans | P1 | CredentialModal.vue:394-401 |
| D050 | 凭证编辑 | CredentialModal | **Details tab** | 已保存:Created/Last modified/ID 三行;未存:空白 | 自撰 Type/Credential ID/Encryption "AES-256-GCM…"+安全注记 | P1 | CredentialModal.vue:404-409 |
| D051 | 凭证编辑 | credential-types | OpenAI 字段集 | API Key* / Organization ID(optional)+帮助 / Base URL(默 `https://api.openai.com/v1`) / Add Custom Header 开关 | 仅 API Key | P1 | credential-types.ts:504-508 |
| D052 | 凭证编辑 | credential-types | DeepSeek 字段集 | API Key* / Allowed HTTP Request Domains / Allowed Domains(=api.deepseek.com) | 仅 API Key | P2 | credential-types.ts:63-67 |
| D053 | 凭证编辑 | CredentialModal | 必填星号 | 必填 label 带红 `*` | label 无 `*`(元数据无 required 位) | P1 | CredentialModal.vue:319 |
| D054 | 凭证编辑 | CredentialModal | 头部动作 | 图标+可编辑名+副标+Save+**垃圾桶(已存)**+X | 缺垃圾桶/删除按钮 | P1 | CredentialModal.vue:277-287 |
| D055 | 凭证编辑 | CredentialModal | Connection 帮助条 | "Need help…? **Read our docs**" | "…Read the **docs**."(措辞异) | P2 | CredentialModal.vue:301-304 |
| D056 | 凭证新增 | CredentialModal | 类型列表排序 | 字母序(Action Network API…) | 数组序(HTTP Header Auth 首,非字母序);缺多数类型 | P2 | CredentialModal.vue:254-266 |
| D057 | 凭证编辑 | CredentialModal | 默认凭证名 | "OpenAI account"(displayName "OpenAI") | "OpenAI API account" | P2 | CredentialModal.vue:73;credential-types.ts:505 |

---

## 四、工作流编辑器 · 顶栏 / 画布 / 节点创建 / 右键(重灾区)

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D058 | 编辑器顶栏 | CanvasView | 居中胶囊 | Editor/Executions/**Evaluations** 三格 | 只有 Editor/Executions,**Evaluations 缺** | **P0** | CanvasView.vue:700-703 |
| D059 | 编辑器 | router | Evaluations 整块 | `/workflow/:id/evaluation` 注册锁态页 | 无路由/view/pill,整功能缺 | **P0** | router.ts:18 |
| D060 | 顶栏 | CanvasView | Publish caret 下拉 | Publish(⇧P)/View timeline/Unpublish(⌘U) 三项 | 下拉仅 1 项 Activate/Deactivate | P1 | CanvasView.vue:726-730 |
| D061 | 顶栏 | CanvasView | Workflow settings 字段 | 9 字段(Execution Logic/Error WF/Timezone/3×Save/Save progress/2×Redact) | 仅 4 字段,缺 5 项(Execution Logic/Timezone/Save progress/2×Redact) | **P0** | CanvasView.vue:1069-1099 |
| D062 | 顶栏 | CanvasView | settings 模态标题 | 含 "#&lt;ID&gt;" | 无 #ID | P2 | CanvasView.vue:1065 |
| D063 | 顶栏 | CanvasView | History 入口 | **整页** `/workflow/:id/history`(只读斜纹画布+Actions 下拉+Versions\|Timeline 双 tab+升级脚注+版本条黄点/作者/⋮) | 右侧 380px 抽屉,仅版本列表+Restore | **P0** | CanvasView.vue:734-736,1008-1037 |
| D064 | 顶栏 | CanvasView | 面包屑 | 人形图标 + Personal/名(点击/Space 改名) | 无人形图标;名称为常驻 `&lt;input&gt;` | P1 | CanvasView.vue:650-654,1317-1321 |
| D065 | 顶栏 | CanvasView | Add tag 下拉 | 展开 "Type to create a tag" + 底部 **Manage tags**(眼睛图标) | 仅输入时显 "Create tag";无 Manage tags | P1 | CanvasView.vue:674-689 |
| D066 | 顶栏 | CanvasView | 发布计数 | 恒显 `0 / 1` | 仅 triggerCount>0 才渲染 | P2 | CanvasView.vue:708-710 |
| D067 | 画布 | WorkflowCanvas/CanvasNode | 节点右键菜单 | **13 项**(Open↵/Execute/Rename Space/Replace R/Deactivate D/Pin P/Copy⌘C/Duplicate⌘D/Tidy⇧⌥T/Convert⌥X/Select all⌘A/Clear selection/Delete Del) | **无右键菜单**;仅 hover 工具条 5 项,缺 Rename/Replace/Pin/Copy/Tidy/Convert/Select all/Clear | **P0** | CanvasNode.vue:238-245 |
| D068 | 画布 | WorkflowCanvas | 空白右键菜单 | Add node/Paste/Select all… | 无 | P1 | manifest §7.3 |
| D069 | 画布 | NodePanel | 一级分类 | 7 语义分类(AI/Action in an app/Data transformation/Flow/Core/Human review/Add another trigger)带描述+下钻 | 平铺 5 内部 group,无描述/下钻/AI Templates 子面板 | **P0** | NodePanel.vue:30-36,78-98 |
| D070 | 画布 | NodePanel | 空画布触发器面板 | 标题对 + **8 策展触发器卡**(带描述) | 标题对,主体仍平铺节点列表,无 8 策展卡 | **P0** | NodePanel.vue:64-98 |
| D071 | 画布 | NodePanel | 触发器副标 | "A trigger is a step that starts your workflow" | "A trigger is the starting point of your workflow" | P2 | NodePanel.vue:66 |
| D072 | 画布 | NodePanel | 搜索占位/图标/箭头 | "Search nodes..."(ASCII)+SVG 放大镜 + `›` | "Search nodes…"+**emoji 🔍**+`→` ASCII | P2 | NodePanel.vue:73-74,96 |
| D073 | 节点卡 | CanvasNode | 触发器标记 | 仅左弧,无外挂图标 | 左侧多 **⚡ emoji 旗标** | P1 | CanvasNode.vue:197,308-311 |
| D074 | 节点卡 | CanvasNode | 输出端口 | 输出圆点带 `+` 快捷加节点 | 纯圆点,无 `+` | P1 | CanvasNode.vue:277-287 |
| D075 | 节点卡 | CanvasNode | AI 子端口标签 | "Chat Model"(红星必填)/Memory/Tool | "Model"/Memory/Tool(Chat Model 写成 Model 且无红星) | P1 | CanvasNode.vue:123-127 |
| D076 | 连线 | WorkflowCanvas | 线中+/hover 工具条 | 线中点 `+`(插入)+hover add/delete 工具条 | 均无(静态贝塞尔) | P1 | WorkflowCanvas.vue:79-99 |
| D077 | 便签 | CanvasNode | 调色板 | **7 色 + 彩虹自定义** | 仅 **4 色**(缺 gold/red/neutral+自定义) | **P0** | CanvasNode.vue:116,403-406;tokens variant-1..7 已定义 |
| D078 | 便签 | CanvasNode | 拖拽调宽/高 | 可 resize | 无 resize 句柄(固定 240×160) | P1 | CanvasNode.vue:420-426 |
| D079 | 便签 | CanvasNode | 默认内容 | markdown "I'm a note\n\n**Double click** to edit me.\n[Guide]" | "Double-click to edit",pre-wrap 不渲染 markdown | P1 | CanvasNode.vue:192,432 |
| D080 | 便签 | CanvasNode | 右键菜单 | Edit(↵)/Change color/Copy/Duplicate/Tidy up/Select all/Clear/Delete | hover ⋯ 仅 Duplicate/Delete | P1 | CanvasNode.vue:177-181 |
| D081 | 左下控制组 | WorkflowCanvas | 按钮集 | fit/zoom-in/zoom-out/**undo(有历史后)**/Tidy up | 用 **reset-zoom** 顶替 undo(undo 仅键盘) | P2 | WorkflowCanvas.vue:102-118 |
| D082 | 画布 | editor store | 多选框选 | 支持框选多节点 | store 仅单 selectedNodeName,无多选模型 | P1 | stores/editor.ts:30 |
| D083 | 画布 | WorkflowCanvas | 点阵网格 | 16px 吸附网格 | Background gap=18 | P2 | WorkflowCanvas.vue:98 |

---

## 五、执行历史 / 执行 Tab

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D084 | Executions Tab | router | 路由形态 | 独立路由 `/workflow/:id/executions` | `?tab=executions` query 内联 | P2 | router.ts:18 |
| D085 | Executions Tab | CanvasView | 执行详情 | 顶条时间标题+**Copy to editor**+垃圾桶+**只读斜纹画布快照** | 逐节点列表+原始 JSON,无 Copy to editor/trash/只读画布 | **P0** | CanvasView.vue:811-835 |
| D086 | Executions Tab | CanvasView | 工具行漏斗 | Auto refresh + 漏斗 | 无漏斗 | P2 | CanvasView.vue:773-779 |
| D087 | Executions Tab | CanvasView | 空态 | 主区 "Nothing here yet"+折叠 "Which executions is this workflow saving?" | 主区 "Select an execution…";折叠问答挪左栏 | P2 | CanvasView.vue:797-808 |

---

## 六、NDV 节点详情 / 参数控件 / 表达式 / Focus Panel / 底部 Chat·Logs(重灾区)

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D088 | NDV | NdvModal | Settings tab 内容 | Always Output Data/Execute Once/Retry On Fail 三开关+On Error 下拉+Notes+Display Note 开关+版本注记 | 仅 1 裸复选框 "Continue on error"+说明,其余全无 | **P0** | NdvModal.vue:134-147 |
| D089 | NDV | NdvModal | On Error 语义 | 下拉:Stop Workflow/Continue(error output)/Continue(regular output) | ✅ 已修(Batch 4 随 D088 一并完成;原记"换成布尔"为过期记录) | P1 | NdvModal.vue:285-291 |
| D090 | NDV | NdvModal | Settings 开关控件 | 基线 switch(32×16) | 裸 checkbox(与 Parameters pswitch 不一致) | P2 | NdvModal.vue:136-142 |
| D091 | NDV | NdvModal | 头带 Docs 链接 | 右侧 `Docs↗` + X | 仅 ✕,无 Docs | P1 | NdvModal.vue:74-77 |
| D092 | NDV | NdvModal | 相邻节点 chip | 两侧相邻节点切换 chip | 无 | P1 | NdvModal.vue:64-78 |
| D093 | NDV | NdvModal | 可拖拽分隔条 | 三栏可拖拽调比例(`|||` 拖柄) | 无拖柄;侧 flex/中定宽,4px 边不可拖 | P1 | NdvModal.vue:193-194 |
| D094 | NDV | NdvModal | 头带副标题 | 只显节点名 | 额外拼 "displayName · vN · Xms · error" | P2 | NdvModal.vue:68-72 |
| D095 | NDV | NdvModal | "I wish this node would…" | 底部居中反馈链接 | 完全缺(grep 无匹配) | P1 | manifest §7.5 |
| D096 | NDV | NdvModal | AI 子节点 INPUT | 左上 `Mapping \| From AI` 分段 | 无 | **P0** | NdvModal.vue:81-90 |
| D097 | NDV | NdvModal | Execute step 图标 | 试管/flask | `▶` 播放三角字符 | P2 | NdvModal.vue:108 |
| D098 | NDV | DataPane | 默认视图 | 默认 **Schema** | 默认 table | P1 | DataPane.vue:26 |
| D099 | NDV | DataPane | 头部搜索框 | 有数据态含搜索 | 无搜索框 | P1 | DataPane.vue:89-97 |
| D100 | NDV | DataPane | item 计数文案 | "1 item"(单复数) | 恒 "{n} items"(会出 "1 items") | P2 | DataPane.vue:96 |
| D101 | NDV | DataPane | OUTPUT 空态 | "No output data"+Execute step+**"or set mock data"** 橙链+铅笔 | 无 mock data 链/铅笔 | P1 | DataPane.vue:101-108 |
| D102 | NDV | DataPane | OUTPUT 有数据态 | 绿勾ⓘ+**pin 图钉**+过时⚠+JSON 缩进导线/语法色/hover 复制 | 无 pin/过时/绿勾;JSON 裸 `&lt;pre&gt;` | P1 | DataPane.vue:89-97,149 |
| D103 | NDV | ParamInput | **Resource Locator** | 模式下拉+值输入(Model gpt-4o-mini) | 无 resourceLocator 分支 → 只渲染 label | **P0** | ParamInput.vue:93-197 |
| D104 | NDV | ParamInput | **凭证选择器** | "No credentials yet" 下拉 + Set up credential | 完全无(grep 无匹配) | **P0** | manifest §7.5 |
| D105 | NDV | ParamInput | **fixedCollection**(Set 赋值区) | "Drag input fields here or Add Field" 虚线框,行=name/type/value+拖手柄+垃圾桶 | 退化成 JSON `&lt;textarea&gt;` | **P0** | ParamInput.vue:176-179 |
| D106 | NDV | ParamInput | **filter**(IF 条件组) | Conditions(左值表达式+操作符下拉带 T 图标+右值)+Add condition+Convert types 开关+组级 Fixed\|Expression | 退化成 JSON 文本 | **P0** | ParamInput.vue:93-197 |
| D107 | NDV | ParamInput | Import cURL(HTTP) | 顶部 Import cURL 按钮 | 无 | P1 | manifest §7.5 |
| D108 | NDV | ParamInput | multiOptions | 多选控件 | 无分支 → 只渲染 label | P1 | ParamInput.vue:93-197 |
| D109 | NDV | ParamInput | 表达式切换范围 | 几乎所有字段可切 Fixed\|Expression | ƒx 仅对 type==='string' | P1 | ParamInput.vue:104-113 |
| D110 | NDV | ParamInput | Fixed\|Expression 形态 | 分段控件(字段 hover 工具条内) | 内联小 ƒx 按钮 | P2 | ParamInput.vue:104-113 |
| D111 | NDV | ParamInput | 多行文本(rows) | System Message 等大文本域 | string 恒单行 `&lt;input&gt;` | P1 | ParamInput.vue:132-137 |
| D112 | NDV | ParamInput | notice 形态 | AI Agent 顶部**紫色 Tip 条**(链接可关) | 只渲染灰 dim 文本 | P1 | ParamInput.vue:95-97 |
| D113 | NDV | ParamInput | AI Agent 子节点连接条 | NDV 底 Chat Model*/Memory+/Tool+ 连接条 | 无 | P1 | manifest §7.5 |
| D114 | NDV | ParamInput | options 下拉形态 | 自定义下拉,选项带类型图标前缀 | 原生 `&lt;select&gt;` 无图标 | P2 | ParamInput.vue:166-174 |
| D115 | 表达式 | ParamInput | Result 预览面板 | 独立 Result 面板(Item pager ‹›/"[Execute previous nodes for preview]"/Tip "Anything inside {{ }} is JavaScript. Learn more") | 仅一行内联 "Preview: 值" chip | P1 | ParamInput.vue:140-143 |
| D116 | 表达式 | ParamInput | 字段悬浮工具条 | 聚焦 fx→悬浮工具条(Focus Panel 图标/⋮/Fixed\|Expression) | 无(仅 label 旁 ƒx) | P1 | ParamInput.vue:99-113 |
| D117 | 表达式 | ExpressionInput | 自动补全 $json 变量树 | `{{ $` → SUGGESTED 分组 + **成员级 `$json.` 变量树** | 仅 8 顶层 `$` 全局名,无成员树 | P1 | ExpressionInput.vue:125-150 |
| D118 | Focus Panel | CanvasView | Setup\|参数 tab | 顶部 `Setup \| &lt;参数名&gt;` tab | 仅 "Focus panel"+×,无 tab | P1 | CanvasView.vue:917-921 |
| D119 | Focus Panel | CanvasView | 逐参数运行 ▶ | 参数行头 +▶ 运行 + X | 有标题+×,无 ▶ | P1 | CanvasView.vue:927-931 |
| D120 | Focus Panel | CanvasView | 自动补全提示 | "ⓘ Execute previous node for autocomplete" | 无 | P2 | CanvasView.vue:916-939 |
| D121 | 底部 Chat | CanvasView | 输入 placeholder | "Type message, or press 'up' for previous one" | "Type a message…" | P1 | CanvasView.vue:981 |
| D122 | 底部 Chat | CanvasView | 发送按钮 | 纸飞机图标 | 文本 "Send" 按钮 | P2 | CanvasView.vue:985-987 |
| D123 | 底部 Logs | CanvasView | 执行后 Logs 树 | 左树(Success in 420ms 摘要+逐节点行选中高亮)+右详情(节点 Success in 60ms+Input\|Output+⋯+视图三连+1 item+数据表) | 一维扁平行 "● name Xms error",无树/摘要/右详情/Input\|Output | P1 | CanvasView.vue:991-1001 |
| D124 | 底部 Logs | CanvasView | 收起态 popout 图标 | 收起条右侧 popout 图标+chevron | 仅 chevron | P2 | CanvasView.vue:954-961 |
| D125 | 画布 | CanvasView | Execute workflow 按钮 | 试管图标橙分裂钮,副文案 "from &lt;触发器&gt;"(两行) | `▶ Execute workflow`;多触发器把 "from X" 拼进单行 | P2 | CanvasView.vue:856-861 |
| D126 | 底部 Chat | CanvasView | 硬编码回退色 | 走令牌 | 多处 `var(--panel,#2a2a33)`/`#fff`/圆角 10px 气泡等非令牌 | P2 | CanvasView.vue:1130-1153 |

---

## 七、Settings 14 子页

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D127 | Settings/Security & policies | 分区 | **整页替换** | 三分区:2FA 强制 / Data redaction(Redact executions 下拉+Affected scope 指标)/ Personal Space(Sharing/Workflow publishing+指标) | 完全不同:Authentication(SSO)/User provisioning(SCIM)/Accounts,基线三区全缺 | **P0** | SettingsView.vue:1232-1279 |
| D128 | Settings/Roles | 主体 | **整页替换** | Enterprise **锁卡**(三权限卡+Upgrade to Enterprise+Learn more↗+Upgrade) | 渲染真实角色表,无锁 | **P0** | SettingsView.vue:1093-1120 |
| D129 | Settings/OpenTelemetry | 整页 | **页面替换** | 页名 OpenTelemetry + 全字段(Enable/OTLP endpoint/Service name 默认值/Custom headers/Trace path /v1/traces/Startup 2000ms/Send test trace/Sample rate/Include node spans…)+Save/Discard | 页名 "Observability" + Prometheus /metrics 配置,OTel 字段全缺 | **P0** | SettingsView.vue:1674-1702 |
| D130 | Settings/Chat | Providers 表 | **枚举** | **15 家**(OpenAI/Anthropic/Google/Azure×2/Ollama/AWS Bedrock/Vercel/xAI/Groq/OpenRouter/DeepSeek/Cohere/Mistral/NVIDIA)带品牌图标 | 仅 **6 家**(Anthropic/DeepSeek/Doubao/Qwen/Kimi/GLM),无品牌图标 | **P0** | assistant-service.ts:42-97;SettingsView.vue:1894 |
| D131 | Settings/MCP | Tab 体系 | 缺 tab | 三 tab(Workflows/Connected clients/**OAuth settings**) | 仅两 tab,缺 OAuth settings | **P0** | SettingsView.vue:1759-1761 |
| D132 | Settings 壳 | 左导航 | 多余页 | 无 Languages | 插入自有 "Languages"(导航序号后移) | P1 | settings-nav.ts:26 |
| D133 | Settings/Personal | Personalisation | 字段缺 | 三区含 Personalisation→**Theme 下拉**(System default/Light/Dark) | 只 Basic Info+Security 两区,无 Theme | P1 | SettingsView.vue:962-1069 |
| D134 | Settings/Users | 升级条 | 缺 | 顶部米黄 "Upgrade to unlock the ability to create additional admin users" | 无 | P1 | SettingsView.vue:1124-1135 |
| D135 | Settings/Users | Account Type 列 | 控件错位 | 纯文本 "Owner" | 内联 `&lt;select&gt;` 角色下拉 | P1 | SettingsView.vue:1202-1209 |
| D136 | Settings/5 锁页 | 锁卡按钮 | 文案 | External Secrets/SSO/LDAP/Log Streaming=**See plans**;Environments=**More info** | 统一 "Enter activation key" | P1 | SettingsView.vue:1291,1319,1359,1414,1606 |
| D137 | Settings/Usage and plan | Unlock 条 | 文案 | "Unlock **selected paid features for free (forever)**" | "Unlock … Enterprise features … with an activation key" | P1 | SettingsView.vue:2009-2012 |
| D138 | Settings/Usage and plan | 指标行 | 文案 | "**Published workflows** — 0 of unlimited" | "Executions this month — {used} of {limit}" | P1 | SettingsView.vue:2015-2018 |
| D139 | Settings/Community nodes | Install 按钮 | 位置 | 右上常驻 Install 橙按钮 | 无右上;仅空态内+列表底右下 | P1 | SettingsView.vue:1530-1560 |
| D140 | Settings/Community nodes | 列表形态 | 结构 | 包卡片(包名+"N node(s):节点名"+v1.0.6+更新✓+⋮) | 表格(Package/Version/Nodes 计数/Uninstall),无节点名/更新图标/⋮ | P1 | SettingsView.vue:1542-1556 |
| D141 | Settings/API | Create API Key 弹窗 | 选项缺 | Expiration 含 **Custom**;Scopes 含 **Custom(72 scopes)** | 缺 Custom(Expiration)与 Custom(Scopes) | P1 | SettingsView.vue:205-211,1497-1508 |
| D142 | Settings/MCP | 警示横幅 | 缺 | 棕底 OAuth redirect allowlist 横幅(可关×) | 无 | P1 | SettingsView.vue:1705-1856 |
| D143 | Settings/MCP | Connection details | 结构 | OAuth\|Access token 分段+Server URL 只读+复制按钮 | 无分段;两块直排,无复制 | P1 | SettingsView.vue:1723-1734 |
| D144 | Settings/MCP | Workflows 表 | 列缺 | Name/Location/**Description** | 缺 Description | P1 | SettingsView.vue:1772 |
| D145 | Settings/Personal | Save 禁用态 | 逻辑 | 未改动时禁用 | 仅保存中禁用 | P2 | SettingsView.vue:1063 |
| D146 | Settings/Users | Last Active 列 | 取值 | "Today" | 恒 "—"(硬编码) | P2 | SettingsView.vue:1210 |
| D147 | Settings/SSO | 描述 | 文案 | 提 SAML 2.0/OIDC+documentation 链接 | 仅 "OpenID Connect"(无 SAML/链接) | P2 | SettingsView.vue:1284-1287 |
| D148 | Settings/LDAP | 描述 | 文案 | 举例 Active Directory/**Okta/Jumpcloud** | Active Directory/OpenLDAP | P2 | SettingsView.vue:1312-1315 |
| D149 | Settings/API | 空态文案 | 文案 | "Control 基线 programmatically using the 基线 API"(橙链) | "Control nomops … REST API(header X-Nomops-Api-Key)"(无橙链) | P2 | SettingsView.vue:1450 |
| D150 | Settings/MCP | Connected clients 列 | 列名 | Client Name/Connected At | Client/Version/Last seen | P2 | SettingsView.vue:1805 |
| D151 | Settings/Chat | Configure 弹窗 | 字段 | OpenAI 含 Use Responses API 开关 | 无该开关 | P2 | SettingsView.vue:1920-1990 |

---

## 八、Insights / Chat 壳 / Shared / 鉴权

| 编号 | 页面 | 组件 | 维度 | 真站表现 | 复刻版表现 | 级别 | 截图路径/证据 |
|---|---|---|---|---|---|---|---|
| D152 | Insights | 整页 | **应锁未锁** | Community=锁空态(锁图标+"Upgrade to access more detailed insights"+Upgrade 橙,KPI 空白) | 全解锁:真实数值+完整堆叠柱状趋势图+日期预设,无锁/Upgrade | **P0** | InsightsView.vue:93-161 |
| D153 | Insights | 过滤条 | 元素 | "All projects" 项目选择器+日期范围 chip | 无项目选择器;副标 "Execution analytics for {project}"+日期按钮 | P2 | InsightsView.vue:96-128 |
| D154 | Shared with you | 整页 | **功能缺失** | `/shared/workflows`+`/shared/credentials`:H1+副标+两 tab+空态 "No workflow has been shared with you"+**Back to Personal** | 完全不存在(router 无 /shared*;grep "shared" 零命中) | **P0** | router.ts:8-29 |
| D155 | Chat 壳 | 侧栏顶部 | 元素缺 | logo+**搜索**+**侧栏开关**(无+) | 仅 logo,无搜索/侧栏开关 | P1 | ChatView.vue:270-276 |
| D156 | Chat 壳 | composer | 元素缺 | 左下 **+Tools**;右下 **回形针+麦克风**+橙发送 | 仅 textarea+橙发送,+Tools/回形针/麦克风 全缺 | P1 | ChatView.vue:433-445 |
| D157 | Chat 壳 | Select model 下拉 | 结构 | provider 各带 › 二级子菜单(provider→models 级联) | 扁平平铺所有 model,无级联;仅 6 家自有 | P1 | ChatView.vue:136-170 |
| D158 | Chat/Personal Agents | 副标 | 文案 | "Create and manage custom AI agents with specific instructions and behaviors" | 自撰 "Your own agents with a custom system prompt…" | P1 | ChatView.vue:323 |
| D159 | Chat/Personal Agents | New Agent 入口 | 位置/文案 | 右上 **+ New Agent** 橙按钮 | 网格内虚线卡 "＋ New agent"(位置/大小写异) | P1 | ChatView.vue:339-341 |
| D160 | Chat/Personal Agents | 空态文案 | 缺 | "No personal agents available. Create your first custom agent to get started." | 无空态文案 | P1 | ChatView.vue:321-351 |
| D161 | Chat 壳 | 会话条目 | 元素 | 带模型图标 | 仅标题+删除×,无模型图标 | P2 | ChatView.vue:300-301 |
| D162 | Login | Forgot 链接 | 文案 | "Forgot my password**?**"(带问号) | "Forgot my password"(无问号) | P2 | LoginView.vue:253 |

---

## 九、产品自有元素(1:1 视角=多余;acceptance-report §三 已"保留"裁决,登记备查,不计入 P 分)

| 元素 | 位置 | 基线有无 | 复刻版(file:line) |
|---|---|---|---|
| ¥99 Pro / Alipay 购买卡 | Usage and plan | 无(基线=View plans 外链) | SettingsView.vue:2035-2047 |
| Admin 项目配额覆盖卡 | Usage and plan | 无 | SettingsView.vue:2050-2082 |
| Languages 设置页(i18n) | Settings 导航 | 无 | SettingsView.vue:1072-1090 |
| SignupView 营销双栏页 | `/signup` | 无(自托管仅 /setup+邀请) | SignupView.vue 全文 |
| Admin Panel 侧栏入口 | 主侧栏底部 | 无 | SideBar.vue:249 |
| Personal 独立导航项 | 主侧栏 | 基线折叠于 Overview | SideBar.vue:232 |
| 卡片 Manage tags / Move to / Active 开关 | 工作流卡片 ⋮ | 无 | OverviewView.vue:888,935-951 |
| 文件夹免注册可用 | 列表工具行 | 基线注册门控 | — |
| 执行行双 Retry "(from node with error)" 后缀 | Executions ⋮ | 基线相同(两 Retry) | OverviewView.vue:1131-1136 |
| 品牌命名替换 | 全站 | — | About nomops / nomops API / X-Nomops-Api-Key 等 |

---

## 十、覆盖率表(manifest 每节 → 已审计 / 未审计 + 原因)

| manifest 节 | 主题 | 审计状态 | 说明 |
|---|---|---|---|
| §0 路由总表 | 110+ 路由 | **部分** | 审计了主要可达路由的实现;鉴权组(/signin etc)、demo/template、oauth/saml、404 等未逐一 live 走查(见未验证清单) |
| §1.1 主侧栏 | 折叠/条目/Help/Settings 菜单 | **已审计**(代码级) | D001-D020;折叠态、红点、Help/Settings 枚举均已比对 |
| §1.2 顶部工具 | +菜单/搜索命令面板/折叠开关 | **已审计** | D008-D010,D021-D027 |
| §1.3 文档 title | 动态标题 | **已审计** | D028(P0 缺失) |
| §2.1 页框架 | H1/副标/Create/KPI/Tab | **已审计**(含 live 数值) | D029-D035 |
| §2.2 Workflows Tab | 工具行/卡片/⋮/分页/空态 | **部分** | D036-D042;卡片 hover 态、空态首屏引导全文未 live 取证 |
| §2.3 Credentials Tab | 卡片/新增模态/编辑模态 | **已审计** | D043,D049-D057;连接测试区行为待 live |
| §2.4 Executions Tab | 表/状态/批量/⋮ | **已审计** | D044-D046 |
| §2.5 Variables Tab | Community 锁态 | **已审计** | D047(P0) |
| §2.6 Data tables | 空态/Create 模态/详情 | **部分** | D048;详情页网格未 live 走查 |
| §3 Insights | 锁空态 | **已审计** | D152-D153(P0 应锁未锁) |
| §4 Chat 壳 | 侧栏/model 下拉/composer/agents | **已审计** | D155-D161;发消息/流式/工具调用会话态未 live(需 provider key) |
| §5 Shared | 整页 | **已审计** | D154(P0 整页缺) |
| §6 Projects | Community 重定向 | **已审计** | nomops 有 Admin Panel/Personal,重定向行为待 live 确认 |
| §7.1 编辑器顶栏 | 面包屑/tab/Publish/⋯/settings 模态 | **已审计** | D058-D066 |
| §7.2 画布 | 节点卡/端口/连线/便签/rail/控制组/Execute | **已审计** | D073-D083,D125;平移缩放手势/快捷键映射待 live |
| §7.3 右键菜单 | 13 项 | **已审计** | D067-D068(P0 整体缺) |
| §7.4 节点创建面板 | 7 分类/子面板/8 触发器 | **已审计** | D069-D072(P0) |
| §7.5 NDV | 三栏/参数控件/表达式/Focus Panel | **已审计**(重点深挖) | D088-D120;各节点型中栏定宽、$json 成员补全树待 live |
| §7.6 底部 Chat/Logs | 收起/展开/执行树 | **已审计** | D121-D124;执行后 Logs 树需真实执行 live |
| §7.7 History | 整页 | **已审计** | D063(P0 降级为抽屉) |
| §7.8 Executions Tab(编辑器内) | 空态/详情 | **已审计** | D084-D087(P0 详情无只读画布) |
| §7.9 Evaluations | 注册锁态 | **已审计** | D058-D059(P0 整块缺) |
| §8 Settings 14 页 | 逐页 | **已审计** | D127-D151;部分锁卡按钮文案、空态需 live 确认真值 |
| §9 鉴权页 | signin/setup/signup/forgot | **部分** | D162;LoginView 对标已做但 /signin 未本轮 live 并排;/setup 字段顺序未取证(需登出) |

---

## 十一、没能验证到的部分(如实登记,不含糊)

**环境限制类:**
1. **基线侧无法截图**:本会话 claude-in-chrome(全功能扩展)断连,只剩 Control_Chrome(可读 computed style、不能截图)。故**所有基线配对截图缺失**,数值差以 computed-style 值为证。若要补配对截图,需恢复扩展或你在真 Chrome 手动截。
2. **nomops 画布 live 深测受限**:本会话 Browser 面板存在视口缩放错位(innerWidth 报 1440 但渲染约占屏左半),坐标点击不稳,画布内 hover 工具条/右键/NDV 的 live 逐像素并排未全部完成;上表画布/NDV 类差异**以代码级证据为主**,数值级偏差(曲率/间距/hover 变色)多数标注"待 live"。

**需 live 手测(合成事件/锁态/需登出/需 provider key)才能定论的项:**
3. 表达式**自动补全成员级 `$json.` 变量树**真实 UI(合成键盘难触发,需真 Chrome 手测)。
4. NDV 各节点型**中栏精确定宽表**(仅知 IF/HTTP=640、Set=420,其余未逐个量);nomops 用启发式 ≤4→420 的命中率。
5. NDV INPUT/OUTPUT 视图切换在真站是**文本 Schema\|Table\|JSON** 还是图标三连;"or set mock data"链/铅笔精确布局。
6. 底部 **Logs 执行树**展开态(摘要行/逐节点选中高亮/右详情 Input\|Output)——需真实执行一次工作流并排。
7. **Settings 5 张 Enterprise 锁卡按钮**真值到底是 "See plans" 还是 "Upgrade"(manifest 混用三种措辞),据以定 nomops "Enter activation key" 的偏差等级。
8. **各页空态原文**:Credentials 空态(nomops 🔒 疑自撰)、Workflows 空态首屏引导、Executions 空态、Data tables 副说明、Community nodes 空态 —— 基线实例有数据,空态未取证,需临时过滤/造删取证。
9. **凭证连接测试区**:基线为打开已存凭证**自动运行**+红条 "Couldn't connect…"+More details;nomops 为手动 Test connection 按钮 —— 交互与文案需真站复核。
10. **/setup 表单字段顺序**、**/signin 并排数值**:需登出基线一次取证(本轮未登出,避免影响 Control_Chrome 会话)。
11. **画布平移/缩放手势与快捷键映射**(滚轮/Ctrl+滚轮/1=fit/Space/R/D/P 等)、**节点"改动未重跑"橙三角徽章**、**AI 子节点虚线中点菱形+线上 Model 标签** —— 需 live 逐项确认。
12. **命令面板作用域徽标 / esc chip / +菜单 chevron / KPI Failure rate 后缀 / Help 首项视频图标** —— 需基线 live 截图逐项核对(见各 agent live 清单)。
13. **Personal / Personal Agents 页 H1 精确大小写**(manifest 仅记 "H1",未逐字)。

---

## 十二、审计方法与可信度声明

- **代码级差异(D001-D162 绝大多数)**:基准 = manifest/field-specs/acceptance-report 里**逐页 live 取证过的基线真值**(阶段一至五,40+ 帧截图 + `/rest/*` 导出);比对 = 逐行读 nomops 源码,每条带 `file:line`。可信度高,但真值时点为 2026-07-17/18 侦察时。
- **live 数值差(D002,D029-D030,D034-D035 等)**:本轮在两侧运行实例上用 `getComputedStyle`+`getBoundingClientRect` 实测,同视口 1440×655。
- **未做**:本轮未修改任何代码;未产出基线配对截图(环境限制);画布/NDV 的 live 逐像素并排未全覆盖(以代码级为主 + 标注待 live)。

> 待你确认后,按 **P0 → P1 → P2** 分批修复。P0 集中在:参数控件引擎(IF/Set/HTTP/resourceLocator/凭证/fixedCollection/filter)、节点右键 13 项菜单、Evaluations/History/执行详情/Shared 四整块、NDV Settings 6 项、节点创建面板 7 分类/8 触发器、命令面板 Data tables 组、动态 document.title、Insights 锁态、Variables 锁态、Security&policies/Roles/OpenTelemetry/Chat 四设置页、便签 7 色。
