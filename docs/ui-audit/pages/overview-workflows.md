# 页面审计 · Overview（工作流/凭证/执行/变量/数据表）P1

- 基线路由：`/home/workflows` 等（VIEWS.WORKFLOWS 家族，`app/views/WorkflowsView.vue` + `features/credentials/views/CredentialsView.vue` + `features/execution/executions/views/ExecutionsView.vue` + `ProjectVariables.vue` + Data Table 模块）
- Nomops 路由：`/`（`views/OverviewView.vue`，1864 行）—— **单页 + tab**，`?tab=workflows|credentials|executions|variables|datatables`
- 截图：`screenshots/n8n/home-*.png`；`screenshots/nomops/overview-*.png`

> **关键 IA 差异**：n8n 每个资源是**独立路由**（`/home/workflows`、`/home/credentials`…），共享 Overview 外壳；Nomops 合并为**一个路由 + query tab**。视觉与交互一致，仅 URL 结构不同（Nomops 保留 `/credentials`→`?tab=credentials` 重定向兼容）。信息架构等价，**不计为功能 gap**。

## A. 页面级（共享外壳）
- 标题 `Overview` + 副标题「All the workflows, credentials and data tables you have access to」——Nomops 逐字一致。
- 右上主操作按钮随 tab 变（Create workflow / Create credential / Create variable…）+ 下拉——一致。
- 5 张 KPI 卡（Prod. executions / Failed prod. executions / Failure rate / Time saved / Run time avg）——Nomops 一致，含 Time saved 的 ⓘ tooltip。
- Tab 行：Workflows/Credentials/Executions/Variables/Data tables——一致。

## B. 各 Tab 对照

### B1. Workflows
| 元素 | n8n | Nomops | 差异 |
|---|---|---|---|
| 搜索框 | `Search` | 有 | 一致 |
| 排序 | `Sort by last updated`（下拉：名称/创建/更新） | 有 | 一致 |
| 筛选 | 漏斗 icon（标签/状态/归属） | 有 | 一致 |
| 新建文件夹 | 文件夹＋ icon | 有（folder icon） | 一致 |
| 文件夹筛选胶囊 | `📁 <名> ×` | 有（`📁 测试 ×`） | 一致 |
| 行结构 | 名称 + `Last updated / Created / N prod run` + 归属徽章 + `⋯` | 一致 | 一致 |
| 行内 `⋯` | Open/Share/Duplicate/Archive/Delete… | 待逐项核对 | ⏳ |
| 分页 | `Total N` + 页码 + `50/page` | 一致 | 一致 |

### B2. Credentials
列表：搜索、排序、筛选、行（图标+名+类型+`Last updated/Created`+归属+`⋯`）。**Nomops 一致**。详见 `pages/credentials.md`。

### B3. Executions
见 `pages/executions.md`（Auto refresh + 表格 + 批量）。

### B4. Variables ⚠️
| 状态 | n8n（本实例=已授权） | Nomops 现状 | 差异 |
|---|---|---|---|
| 空态 | 👋「Kane, let's set up a variable」+ `Add first variable` | 「Upgrade to unlock variables」paywall + `View plans` | **不一致（逻辑）** |

> Nomops Usage 页自称「Enterprise Edition」，但 Variables tab 仍显示**未授权 paywall 空态**（n8n 社区版文案）。→ **变量授权门控逻辑与 license 状态不一致**（P2，需核对 `OverviewView` 变量 tab 的 `isLicensed`/feature flag 判定）。

### B5. Data tables
模块页（`/home/datatables`）。Nomops 有 `?tab=datatables` + `/datatables/:id` 详情。需核对列表列定义/新建流程（⏳ 下轮）。

## C. 全局外壳（左侧 Sidebar）
| 元素 | n8n | Nomops | 差异 |
|---|---|---|---|
| Logo | n8n | nomops 品牌 logo | 品牌替换（正确） |
| 顶部 | ＋新建 / 🔍搜索 / 折叠 | 一致 | 一致 |
| 主导航 | Overview(Home) / Personal / Chat`Preview` | 一致 | 一致 |
| PROJECTS 组 | 项目列表 | `My project` / `测试` | 一致 |
| 底部 | Templates / Insights / Help(红点) / Settings | 一致 | 一致 |
| 展开态 | n8n 截图为**图标窄栏**（可展开） | Nomops 默认**展开带标签** | 默认态不同（皆合理，非 gap） |

## D. 差异小结（进 gap-list）
1. **Variables tab 授权门控**：Nomops 在 Enterprise 下仍显示 paywall 空态 —— 逻辑不一致（P2）。
2. 行内 `⋯` 菜单项、Data tables 列表细节 —— 待下一轮核对。
3. URL 结构差异（独立路由 vs query tab）—— 记录不改（IA 等价）。
