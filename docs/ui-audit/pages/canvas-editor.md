# 页面审计 · 工作流编辑器（画布 / NDV / Logs）P0

- 基线路由：`/workflow/:workflowId/:nodeId?`（VIEWS.WORKFLOW，layout=workflow）
- Nomops 路由：`/workflow/:id`（`views/CanvasView.vue`，1666 行）
- 基线源码：`app/views/NodeView.vue` + `features/canvas/*` + `features/ndv/*` + `features/logs/*`
- 截图：`screenshots/n8n/editor-workflow.png` · `node-creator.png` · `ndv-node-detail.png`；`screenshots/nomops/canvas.png` · `ndv-node-detail.png`
- **设计红线**：节点图标 n8n 彩色、Nomops monochrome-first（仅激活数据连线着色）——此为设计系统差异，**不计为 gap**。

## A. 页面级
三段式布局：顶栏（workflow header）+ 主画布（Vue Flow）+ 底部可折叠 LogsPanel。右侧竖排画布工具条，左下角画布控制。NDV 为覆盖式三栏抽屉（非路由）。

- 加载态：画布骨架 + 节点淡入；Nomops 同构。
- 空态：新工作流显示居中虚线「Add first step…」+ 触发器节点创建面板（见 node-creator）。Nomops 有等价空态。
- 只读态：执行预览/历史/调试进入斜纹只读画布（`readOnlyCanvas` meta）。Nomops 有 `ReadOnlyCanvas.vue`。

## B. 组件级

### B1. 顶栏（Workflow header）
| 元素 | n8n | Nomops 现状 | 差异 |
|---|---|---|---|
| 面包屑 | `Personal / <名称>` + `+ Add tag` | 同（`Personal / Branch & merge starter` + `+ Add tag`） | 一致 |
| 中央 Tab | Editor / Executions / Evaluations | 同三 Tab | 一致 |
| 激活计数 | `0 / 1`（活跃触发器/总触发器） | 显示 `0 / 1` | 一致 |
| 发布 | `Publish` 主按钮 + 下拉 | 同 | 一致 |
| 版本历史 | 时钟 icon → `/history` | 同 icon | 一致 |
| `⋯` 菜单 | Download/Duplicate/Import/Delete/Settings 等 | Download/Duplicate/Import/Delete | 需核对 Settings/Push 项 |
| GitHub Star | 有（n8n 品牌） | **无** | 多余项正确移除（红线：禁 n8n 字样） |

### B2. 画布工具条（右侧竖排）
| 按钮 | n8n | Nomops | 差异 |
|---|---|---|---|
| ＋ 添加节点 | 有（打开 node creator） | 有（`editor.nodePickerOpen`，快捷键 N） | 一致 |
| 🔍 搜索节点 | 有 | 有 | 一致 |
| 便签/复制 | n8n 顶部工具含便签 + 复制 | 便签（addStickyNote，⇧S） | 需核对「复制选区」入口 |
| 折叠面板 | 有 | 有 | 一致 |

### B3. 画布控制（左下角）
Fit-to-view / Zoom in / Zoom out / Undo / Tidy-up（⇧⌥T）——Nomops 五个齐全且快捷键对齐。**一致**。

### B3.1. 画布节点本体 —— 已核实一致 ✅

2026-08-01 按本地基线实例重新实测并落地：普通节点为 96×96、图标 48×48、主端口 16×16、标签外置且为 16px/500；触发器轮廓为 `36px 8px 8px 36px`；选中态保留默认 20% 白色边框，并使用 6px/40% 白色外环。隔离生产实例复验计算样式一致，分支标签正常，控制台无 warning/error。

### B4. 执行区（底部中央）
| 元素 | n8n | Nomops 现状 | 差异类型 |
|---|---|---|---|
| 执行按钮文案 | `Execute workflow from <触发器名>`（动态） | `Execute workflow`（无触发器名） | **不一致**（缺触发器名标签） |
| 执行按钮下拉 | 有（多触发器时选择起点） | 无明显下拉 | **缺失**（多触发器选择） |
| Open chat | chat-trigger 工作流显示 `Open chat` | **无** | **缺失** |
| 快捷键 | ⌘↵ | ⌘↵（一致） | 一致 |

### B5. LogsPanel（底部面板）
- n8n：`Chat | Logs` 双 Tab（有 chat trigger 时显示 Chat + Session id + 复位）。
- Nomops：仅 `Logs`（无 Chat tab）。→ 与 B4 的 Open chat 缺失同源：**缺失 画布内嵌 Chat 测试面板**。

### B6. 节点创建面板（Node Creator）—— 已核实 ✅
- n8n 触发器面板「What triggers this workflow?」：搜索 + 9 个策展入口。
- Nomops `NodePanel.vue` **已 1:1 复刻**「What triggers this workflow?」+ 9 张策展触发器卡（逐字对齐 n8n 文案）：Trigger manually / On app event / On a schedule / On webhook call / On form submission / **When executed by another workflow** / On chat message / When running evaluation / Other ways。空白态搜索同样只返回触发器，选定触发器后才进入 `What happens next?`。**一致**。

### B7. NDV（节点详情视图）
三栏：INPUT（Schema/Table/JSON + N ITEMS + 「Execute previous nodes」空态）| 中央（Parameters/Settings Tab + 「Execute step」按钮 + 字段/表达式 + 「I wish this node would…」反馈）| OUTPUT（Schema/Table/JSON + 「Execute step」空态）。
**Nomops `NdvModal.vue` 已 1:1 复刻三栏结构**（见 nomops/ndv-node-detail.png）。差异：

2026-08-10 节点级复核补充：第二批已完成 Manual Trigger / Schedule Trigger / Webhook / HTTP Request / Edit Fields / IF / Switch / Code 的字段结构和组合控件对齐，包括 Webhook URLs、Trigger Rules、Fields to Set、Routing Rule + Rename Output、Code 行号编辑区。

2026-08-11 第三批补充：Webhook test-listener（一次性、超时、草稿执行）、Schedule 多 Rule DB 调度、HTTP Request Import cURL、Code Python 受限运行时均已完成并通过真实浏览器/API 验收。当前本地 n8n 的 Code 节点无 Ask AI 控件，Nomops 已移除禁用占位，避免把假控件当成功能。多实例 Webhook listener、cURL 冷门 flag 与 Python 任意包环境保留为明确边界，详见 `90-gap-list.md`。

2026-08-11 第四批补充：Merge、Loop Over Items、Wait、Execute Workflow、Respond to Webhook、Form/Form Trigger 已完成本地 n8n 参数基线采集和声明式动态字段改造。浏览器复验 trigger-first、Merge Combine 与 Wait Webhook Call 时，NDV 三栏、Fixed/Expression、条件显隐和输出空态均正常。

2026-08-11 第五批补充：第四批留下的三条真实运行时边界已闭环。Merge SQL Query 以 `input1..input10` 为表在 64MB/30 秒隔离沙箱执行 AlaSQL，并封禁网络/文件数据源；Execute Workflow Define Below 可校验并以内存工作流执行导出 JSON，不落库且继续继承项目凭证边界与 5 层递归熔断；Form/Form Trigger 公开页按文件字段生成 multipart form，上传受单文件 10MB、单请求 20MB、20 文件限制，输出同时含 n8n 形态 JSON 元数据与 binary 引用。fixedCollection 也补齐 n8n 的 `Add Attributes` 可选字段菜单。浏览器再次核对本地 n8n 的触发器首页、Merge SQL、Workflow JSON 和 File Attributes 动态 UI。
| 元素 | n8n | Nomops | 差异 |
|---|---|---|---|
| INPUT/OUTPUT 三视图 | Schema/Table/JSON | 同 | 一致 |
| Execute step / previous | 有 | 有 | 一致 ✅ |
| 顶部 Docs 链接 | 有 | 有（`Docs`） | 一致 ✅ |
| Parameters/Settings Tab | 有 | 有（`NdvModal.vue:24`） | 一致 ✅ |
| 字段 Fixed/Expression 切换 | 有 | **有**（`ParamInput.vue:245` 分段控件，覆盖 string/number/options/multiOptions/dateTime/color） | 一致 ✅（**修正**先前误判） |
| 参数钉到 Focus 面板 | 有（Focus Panel） | 有（`togglePinParam`，`CanvasView.vue:1056`） | 一致 ✅ |
| **Pin data（钉住节点输出）** | 有（📌 冻结节点输出，下游免重跑测试） | **无**（仅钉参数，无钉输出数据） | **缺失** |

## C. 差异小结（进 gap-list）

> **2026-07-21 live 复验修正**：B4/B5 原判「缺 Open chat + Chat Tab」和 B2「执行按钮缺 from 标签/下拉」**均为误报**——审计时截的是「Branch & merge starter」（单触发器、无 chat trigger），条件渲染的功能没触发。在含 chat trigger 的「AI 客服 Agent」上复验，`Open chat` + `Chat|Logs` 分栏 + chat-panel 全部渲染（`CanvasView.vue:476/1022/1086/1108`）；多触发器时执行按钮显示 `Execute workflow from {trigger}` + caret 下拉（`:993/:997`）。截图 `nomops/canvas-chat-open.png`。

1. ~~缺 Open chat / Chat Tab~~ **误报，已存在** ✅
2. ~~执行按钮缺 from 标签 + 下拉~~ **误报，已存在**（gated on `triggerNodes.length>1`）✅
3. ~~NDV 缺 Pin data（钉住节点输出）UI~~ **P1-2 已修（2026-07-21）**：NDV OUTPUT「Pin/Pinned」按钮 + 画布节点角标 + editor store pinData + autosave 落库；引擎手动执行用冻结数据。见 `90-gap-list.md`。
4. **顶栏 `⋯` 菜单项需补齐核对**（Settings、Push to git 等）（P2-8）。
5. **已核实一致**：Node Creator（9 触发器）、NDV 三栏 + Parameters/Settings + Fixed/Expression + 参数钉 Focus、AI Agent 底部 Chat Model/Memory/Tool 能力入口、Open chat/Chat 面板、多触发器执行下拉。
