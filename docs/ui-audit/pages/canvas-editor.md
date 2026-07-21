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
- n8n 触发器面板「What triggers this workflow?」：搜索 + 8 分类。
- Nomops `NodePanel.vue:27-47` **已 1:1 复刻**「What triggers this workflow?」+ 8 张策展触发器卡（逐字对齐 n8n 文案）：Trigger manually / On app event / On a schedule / On webhook call / On form submission / **When executed by another workflow** / On chat message / Add another trigger（+ 下钻 all triggers）。空态标题/副标题一致（`What triggers this workflow?` / `A trigger is a step that starts your workflow`；非空 `What happens next?`）。**一致**。

### B7. NDV（节点详情视图）
三栏：INPUT（Schema/Table/JSON + N ITEMS + 「Execute previous nodes」空态）| 中央（Parameters/Settings Tab + 「Execute step」按钮 + 字段/表达式 + 「I wish this node would…」反馈）| OUTPUT（Schema/Table/JSON + 「Execute step」空态）。
**Nomops `NdvModal.vue` 已 1:1 复刻三栏结构**（见 nomops/ndv-node-detail.png）。差异：
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
5. **已核实一致**：Node Creator（8 触发器）、NDV 三栏 + Parameters/Settings + Fixed/Expression + 参数钉 Focus、Open chat/Chat 面板、多触发器执行下拉。
