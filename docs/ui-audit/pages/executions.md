# 页面审计 · Executions（全局列表 + 工作流内详情）P0

- 基线路由：
  - 全局：`/home/executions`（`features/execution/executions/views/ExecutionsView.vue`）
  - 工作流内：`/workflow/:id/executions`（列表）+ `…/executions/:executionId/:nodeId?`（详情预览 `WorkflowExecutionsPreview.vue`）
- Nomops：`?tab=executions`（全局，`OverviewView`）+ 画布 `Executions` Tab
- 截图：`screenshots/n8n/home-executions.png` · `exec-detail.png`；`screenshots/nomops/overview-executions.png`

## A. 全局执行列表

| 元素 | n8n | Nomops 现状 | 差异 |
|---|---|---|---|
| Auto refresh | ☑ 复选（默认开，橙勾） | 有（默认开） | 一致 |
| 筛选 | 漏斗 icon（状态/工作流/时间） | 有 | 一致 |
| 全选复选 | 表头 checkbox | 有 | 一致 |
| 列：Workflow | 工作流名 | 一致 | 一致 |
| 列：Status | 图标 + Error/Success（红/绿） | 一致 | 一致 |
| 列：Started | `Jul 16, 16:54:24` | `21 Jul, 13:45` | 格式微差（皆合理） |
| 列：Run Time | `116ms` | `0ms` | 一致（值差） |
| 列：Exec. ID | 顺序整数 `8/7/6…` | 短哈希 `0098bd0c` | **不一致（ID 展示格式）** |
| 列：模式图标 | 手动/触发 icon | 有 icon | 一致 |
| 行 `⋯` 菜单 | Retry/Delete/Open… | 有 | 待逐项核对 |
| 空态提示 | `No more executions to fetch` | 待核对 | ⏳ |
| 批量操作 | 选中后批量删除/停止（`STOP_MANY_EXECUTIONS_MODAL`） | 待核对批量条 | ⏳ |

## B. 工作流内执行详情（`exec-detail.png`）

n8n 结构（Executions Tab）：
- **左栏**：`Executions` 标题 + Auto refresh + 筛选 + 执行项列表（时间戳/状态/时长 + retry/mode icon）；底部「Which executions is this workflow saving?」折叠说明。
- **主区头**：时间戳 + `Error in 116ms | 21KB | ID#8` + 操作：👍👎(标注) / `Debug in editor` / 重试 icon / 清单 icon / 删除 icon / `+ Add tag`。
- **主区体**：只读执行画布，节点带状态（绿勾/红错），错误 toast「Problem in node '…' — Credentials not found」。
- **底部**：`Chat | Logs` 面板。

Nomops 现状（已双侧并排，`nomops/exec-detail.png`）：
- **左栏**：`Executions` + Auto refresh + 执行项（时间戳 / `mode · status · duration`）；底部「Which executions is this workflow saving?」折叠 ✅
- **主区头**：`● Success · chat · started 2026/7/17 21:06:54 · 0ms` + 右侧 `Copy to editor` + 一个小按钮
- **主区体**：只读斜纹画布（monochrome 节点）✅
- **底部**：`Execution data`（折叠面板）

| 元素 | n8n | Nomops 现状 | 差异 |
|---|---|---|---|
| 执行项左栏列表 + Auto refresh | 有 | 有 | 一致 ✅ |
| 「Which executions saving?」折叠 | 有 | 有 | 一致 ✅ |
| 只读执行画布 | 有 | 有 | 一致 ✅ |
| Copy/回填编辑器 | 有 | `Copy to editor` | 一致 ✅ |
| 重试 | 行 `⋮` 两项（saved/original，仅错误可重试） | 行 `⋮` 两项（同措辞，`OverviewView.vue:1199`） | 一致 ✅ |
| **Debug in editor** | 有（企业 DebugInEditor） | **✅ 后续完成**：评测用例输入可钉入 Evaluation Trigger 并回到编辑器 | 一致 ✅ |
| **标注 👍👎 + 评分 tag** | 有（喂评测数据集） | **✅ 后续完成**：execution annotation、tag 与 API/UI 已接通 | 一致 ✅ |
| **头部元信息 `21KB \| ID#8`** | 有（大小 + 执行 ID） | **✅ 后续完成**：显示序列化大小和短 UUID | 语义一致 ✅ |
| 错误 toast「Problem in node」 | 有 | 待并排（本次为 success 执行，未触发） | ⏳ |
| 底部面板 | `Chat \| Logs` | 有 Chat Trigger 时 `Chat \| Logs`，否则 Logs | 条件渲染一致 ✅ |

## C. 相关弹窗
- `STOP_MANY_EXECUTIONS_MODAL_KEY` 批量停止 · `DEBUG_PAYWALL_MODAL_KEY` 调试付费墙 · `ADD_EXECUTION_TO_DATASET_MODAL_KEY` 加入评测数据集 · `ANNOTATION_TAGS_MANAGER_MODAL_KEY` 标注标签管理。—— Nomops 侧对应弹窗多缺失（与标注/评测缺失同源）。

## D. 差异小结（进 gap-list）
1. **Exec. ID 展示**：n8n 顺序整数（易读/可追溯），Nomops 短哈希 —— 不一致（P2，仅前端格式化）。
2. **执行详情头部元信息**：缺 大小(`21KB`) + 执行 ID(`ID#8`)（P2）。
3. ~~**Debug in editor**：缺失~~ **已由 EPIC-EVAL #31 完成**。
4. ~~**执行标注 👍👎 + 评分 tag + 加入评测数据集**：整套缺失~~ **已由 #31/#35 完成评测与执行标注链路**。
5. 本段为 2026-07-21 审计快照；后续完成状态以 `feature-backlog.md` 为准。
