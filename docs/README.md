# nomops — 工作流自动化平台

> 一个节点式（node-based）可视化工作流自动化平台。对标 n8n，采用「共享内核 + 双部署形态」架构：先交付可自部署的 **安装版（self-hosted）**，再在其外包一层 **Cloud Web 平台**（多租户）。

本仓库文档面向 **Claude Code 实施**。阅读顺序即开发依据。

---

## 文档导航

| 文档 | 内容 | 用途 |
|---|---|---|
| `README.md`（本文） | 项目目标、技术栈决策、核心概念 | 全局对齐 |
| `01-ARCHITECTURE.md` | 分层架构、双形态、monorepo 包结构 | 建骨架 |
| `02-DATA-MODEL.md` | 数据库 schema、workflow JSON、节点 schema、执行状态结构 | 定契约 |
| `03-MODULES.md` | 六大内核模块 + 表达式引擎的详细开发规范 | 写实现 |
| `04-ROADMAP.md` | 分阶段里程碑与每阶段验收标准 | 排进度 |
| `05-CLAUDE-CODE-GUIDE.md` | 目录约定、编码规范、测试要求 | 约束 agent |

---

## 一、产品目标（MVP 边界）

**做什么（Phase 1 必须有）**
- 可视化画布：拖拽节点、连线、配置参数、保存工作流
- 执行引擎：按 DAG 顺序跑工作流，节点间传递数据，支持分支/合并/循环
- 节点系统：声明式节点定义，支持懒加载与热重载
- 触发器：Webhook 触发、Cron 定时触发、手动运行
- 凭证管理：加密存储第三方凭证，执行时注入
- 执行历史：每次运行的输入/输出/状态可查、可重跑
- 归属边界：workflow / credential / execution 归属于某个 owner（project）

**先不做（后续阶段）**
- 多租户 Cloud 控制平面、计费、配额
- 企业功能（SSO/SCIM、RBAC 权限方案、审计）
- AI Agent 节点、子工作流、评估（evaluation）

---

## 二、技术栈决策（已拍板，勿再纠结）

**结论：Node.js 22+ / TypeScript 全栈单一语言。**

理由：本项目的核心资产是**节点生态**。要让「节点定义 → 引擎执行 → 前端表单渲染」三者共享同一套类型系统，就必须单语言贯通。跨语言（Go/Python 后端）会打断类型贯通、失去可复用的节点写法，且拖慢交付。Go 的性能/部署优势对 MVP 不是瓶颈——引擎瓶颈在 I/O 与外部 API，不在 CPU。

| 层 | 选型 | 说明 |
|---|---|---|
| 语言/运行时 | TypeScript + Node.js ≥ 22 | 全栈统一 |
| Monorepo | pnpm ≥ 10 + Turborepo | workspace + 增量构建 |
| 后端框架 | Express 5 | 生态稳、与参考实现一致，降低移植成本 |
| 前端框架 | Vue 3 + Pinia + Vite | 状态管理 + 快构建 |
| 画布库 | Vue Flow (`@vue-flow/core`) | 节点/连线/minimap 开箱即用 |
| 代码编辑器 | CodeMirror 6 | Code 节点、表达式高亮 |
| ORM | **Drizzle ORM** | 比 TypeORM 现代、类型更强；节点不依赖 ORM，可自由选 |
| 数据库 | SQLite（默认）/ PostgreSQL | 单机零依赖起步，生产切 PG |
| 队列 | **BullMQ** + Redis | Bull 的现代版，queue mode 用 |
| 实时推送 | `ws`（WebSocket） | 推执行进度 |
| 鉴权 | JWT + argon2 | 会话 + 密码哈希 |
| 校验 | Zod | 节点参数、API 入参、workflow 结构 |
| 测试 | Vitest | 单元 + 集成 |

> 备选：若未来确需 Go 引擎，唯一可迁移的是「执行引擎 + 表达式求值」两块（纯计算、无生态依赖），其余全部保留 TS。届时用 `expr-lang/expr`（Go）替代表达式引擎。**MVP 阶段不考虑。**

---

## 三、核心概念词汇表（全项目统一术语）

| 术语 | 含义 |
|---|---|
| **Workflow** | 一张有向图，由节点（Node）和连接（Connection）组成，序列化为 JSON |
| **Node** | 工作流中的一个步骤。分三类：Trigger（触发）、Action（动作）、Logic（逻辑） |
| **Node Type** | 节点的「类」——声明式定义 + `execute` 函数。用户拖出的是它的实例 |
| **Connection** | 节点间的有向连线，携带数据从上游流向下游 |
| **Item** | 数据流的基本单位。节点输入输出都是 `Item[]`（`INodeExecutionData[]`） |
| **Execution** | 一次工作流运行。产出一个可序列化的 `RunExecutionData` |
| **Credential** | 加密存储的第三方鉴权信息，节点执行时按需解密注入 |
| **Trigger** | 启动工作流的入口：Webhook / Cron / Poll / Manual |
| **Project / Owner** | 归属边界。每个 workflow/credential/execution 属于某个 owner |
| **Expression** | 节点参数里的 `{{ ... }}` 动态求值语法 |

---

## 四、一句话架构

> 一个**纯 TypeScript 单体**（可选 Redis 队列扩展），核心是三层解耦——`workflow`（引擎抽象）/ `core`（执行实现）/ `nodes`（具体节点）——外面套 REST API 与 Vue 画布。安装版是这个单体本身；Cloud 版是在它外面加一层多租户控制平面。

细节见 `01-ARCHITECTURE.md`。
