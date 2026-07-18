# n8n 1:1 复刻 — 阶段五验收报告

> 基准:http://localhost:5679(n8n 2.30.4 stable · Community · dark)
> 复刻:nomops frontend(5181 预览 + 5678 dev server)
> 方法:两侧统一 1440×840 视口,`getBoundingClientRect` + 计算样式**数值化对差**(不目测);
> 差异 → 修复 → 复验闭环,全部数值记录于 manifest.md 阶段五日志。
> 日期:2026-07-18

## 一、已验收页面(7 组)

| # | 页面 | 验收结果 | 残留(量化) |
|---|---|---|---|
| 1 | Overview / Workflows | KPI 格 [249,101,228,99]、卡片列 [248,*,1144]、搜索 [*,293,196,32] 逐像素一致 | 无 |
| 2 | Credentials | 卡片/26px 图标/名称/meta 零差;工具行结构化(Sort+Filters 弹层) | 排序钮宽 +11px(caret 间距) |
| 3 | Executions | 列宽逐列锁定(50/371/153/187/110/98)、行 48/表头 36、"Run time" 文案 | 尾部 flask/retry 图标列(需执行 mode 字段) |
| 4 | 编辑器 chrome | 头带 65px light-3;居中悬浮 tab pill(neutral-800/衬2/格26px);轨钮 36×36 | 无 |
| 5 | 带节点画布 | 节点 96×96/边框 white-alpha-200/触发器 36 圆角/label 16px-192w/连线 oklch(0.42) | 节点间距 280 vs 288(n8n 16px 网格吸附,数据层) |
| 6 | NDV + Settings | NDV 侧弹性+中 640;Exec step 122×28;Settings 轨/条目/H1/表单全中 | 每节点型中栏宽度表(Set=420) |
| 7 | Chat + 命令面板 | 侧栏 200、composer 758/圆角8/环+投影;面板 700/输入 48/20vh | 无 |

## 二、并排验收纠正的单侧测量错误(方法论价值)
1. 节点默认边框:白 63% → **white-alpha-200**(63% 是选中/悬停态)
2. 默认连线:oklch(0.627) → **oklch(0.42)**(0.627 是高亮态)
3. 触发器左圆角:48 → **36**
4. 节点 label:14px → **16px**
5. NDV 侧栏:定宽 375 → **弹性均分**(375 只是 IF 节点 1440 宽下的巧合值)

## 三、产品自有元素裁决表(1:1 视角 = 多余;产品视角 = 功能。请逐项拍板)

| 元素 | 位置 | n8n 有无 | 建议 |
|---|---|---|---|
| Run live demo 按钮 | Overview 页头 | 无 | ✅ 已裁决:移入侧栏 Help 飞出菜单顶部(页头不再有此钮) |
| Admin Panel 入口 | 主侧栏底部 | 无(n8n 无运营台) | 保留(nomops 核心差异化) |
| Personal 导航项 | 主侧栏 | n8n 折叠于 Overview | 保留 |
| ¥99 Pro 支付块 | Settings/Usage | 无(n8n 是 View plans 外链) | 保留(商业化) |
| Languages 设置页 | Settings | 无(n8n 无 i18n 页) | 保留 |
| Observability/Audit 页 | Settings/侧栏 | n8n 为 OpenTelemetry | 保留命名或改名对齐 |
| Delete node 按钮 | NDV 头带 | 无(画布右键) | ✅ 已移除(画布 Delete/Backspace 路径确认存在) |
| 执行行内 Retry 双选项 | Executions ⋮ | n8n 相同(Retry 两种) | ✅ 对齐真值:两项加 "(from node with error)" 后缀,且仅错误执行显示(手测取证) |
| 工作流卡片 Activate/Manage tags/Move to | 卡片 ⋮ | n8n 无(Publish 体系/无移动) | 保留(nomops 功能) |
| 文件夹(免注册可用) | 列表工具行 | n8n 注册门控 | 保留(体验优于 n8n) |

## 四、遗留清单(实现侧,非阻塞)
1. ✅ Executions flask(manual)图标列 —— ExecutionRow 本就含 mode 字段,已实现(47px 列,视觉待有数据时复验)
2. ✅ NDV 中栏宽度 —— 启发式落地:可见参数 ≤4 → 420,否则 640(与 Set/IF 实测吻合)
3. ✅ 排序控件 —— 修正为 n8n 真值 196×32/12px 字(与搜索同宽)
4. ✅ 表达式自动补全弹层 —— 用真 Chrome 打开 n8n NDV 手测取证(SUGGESTED 分组头 10px/600 大写 + 列表 CommitMono/条目衬 2×8/选中 neutral-700 底+purple-400 字 + 右侧 280 宽说明卡/紫 mono 标题)。nomops 侧用 `@codemirror/autocomplete` + `EditorView.theme` 逐值落地,只列引擎真实注入的 8 个 `$` 全局(不造引擎没有的函数),已在 nomops NDV(HTTP Request→URL→ƒx)并排复量:分组头 10/600/大写/衬 2×4、选中 neutral-700+purple-400+CommitMono/衬 2×8、说明卡 280 宽——全中。
5. ✅ 执行行 ⋮ 菜单 —— 同上手测,两个 Retry 项加 "(from node with error)" 后缀并按 status==='error' 门控。
6. ✅ 鉴权页组(login/forgot-password)—— 用真 Chrome 登出 n8n 取证 /signin+/forgot-password 计算样式:页面平铺 light-2、卡片 352×light-3/1px white-alpha-100/圆角 8/投影 rgba(99,77,255,.06) 0 4px16px、标题 20/400、label 14/500 衬下 8、输入 36 高/圆角 6/bg light-2/inset 1px 环(聚焦 purple-500)、按钮 36 橙 primary、链接 16/400 橙。nomops LoginView 已逐值对齐并在 5181 复量(卡片 [544,106,352,352]、输入 36、聚焦环 purple-500——全中);"Forgot my password" 请求页标题改为 n8n 真值 "Recover password"。SignupView 为 nomops 自有营销页(n8n 无对应,保留)。
7. ✅ 节点悬停工具条(canvas-node-toolbar)—— nomops 原先**完全没有**;用真 Chrome(Control_Chrome)读 n8n 20 个真实节点 + 4 便签取证按钮集差异,逐值实现于 CanvasNode.vue:
   - 药丸 `--canvas--color--background`/圆角 4/高 28、按钮 28×28/图标 12(viewBox24 逐字复刻 play/power/trash/ellipsis/palette)/字色 tint-1、默认 opacity0 悬停→1;禁用态边框 → `--color--foreground`、名称补 "(Deactivated)"(均 n8n 真值)。
   - 三种按钮集(实测分流):普通/触发器/Agent/Tool → ▶Execute step·⏻Deactivate·🗑Delete·⋯More;**能力子节点(Model/Memory)去掉 ▶,余 3 键**;便签 → 🗑·🎨Change color·⋯。
   - 动作全部有真实能力:执行=`execution.run(destinationNode)`、禁用=新增 `editor.toggleDisabled`(引擎 workflow-execute 已 input0 直通)、删除=`removeNode`、复制=新增 `duplicateNode`;⋯ 菜单落地 Open/Execute/Deactivate/Duplicate/Delete(n8n 的 Rename/Pin/Replace/Convert-to-subworkflow 暂未实现,不放空项)。
   - 5181 并排复量:触发器 4 键 + 子节点 3 键(a11y group 双证)、⋯ 菜单、删除、禁用(边框 lab20.78=foreground/"(Deactivated)"/title→Activate)、便签 3 键 + 4 色板(黄→蓝切换生效)——全中。

## 五、环境清理记录
- n8n 侧:临时工作流 "UI Verify Tmp" 归档+删除(200/200),零残留
- nomops 侧:2 个种子工作流、1 凭证(204×3)、临时用户 ui-verify@nomops.local、其孤儿 Personal 项目 —— 全部删除;DB 复核仅剩原 owner
- 本仓库新增交付物:manifest.md(带全程勾选与批次/验收日志)、n8n-tokens.css(883/883 等值)、field-specs.md、refs/n8n-node-types-summary.json、acceptance-report.md(本文)
