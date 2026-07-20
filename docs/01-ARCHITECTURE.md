# 01 — 架构设计

## 一、分层原则（最重要，勿违反）

三层解耦是整个项目的地基。破坏它会导致引擎无法独立测试、无法在 worker 里跑、无法做 Cloud 扩展。

```
┌─────────────────────────────────────────────┐
│  packages/nodes      具体节点（HTTP/Code/IF…）  │  依赖 ↓
├─────────────────────────────────────────────┤
│  packages/core       执行引擎实现 + 节点加载     │  依赖 ↓
├─────────────────────────────────────────────┤
│  packages/workflow   引擎抽象（DAG/数据流/表达式） │  零业务依赖
└─────────────────────────────────────────────┘
```

**铁律**
1. `workflow` 包**不含任何具体节点、不碰 DB、不碰 HTTP**。只定义「什么是节点、连接、数据流、如何求值表达式」的纯抽象与类型。
2. `core` 包实现执行引擎和节点加载，依赖 `workflow` 的抽象，但**不碰 HTTP 层**。给它一个 workflow JSON + 起始数据，它能独立跑完。
3. `nodes` 包只写具体节点，依赖 `workflow` 的节点接口。
4. 服务层（`server`）依赖以上全部，负责 HTTP、鉴权、持久化、触发器——是最上面的薄壳。

**验证解耦是否成立的测试**：能否写一个不启动 HTTP server、不连数据库的单元测试，直接 `new WorkflowExecute().run(workflowJson)` 把一个三节点工作流跑完？能，就对了。

---

## 二、双部署形态

### ★语言澄清（写死，勿再纠结）

**Cloud Web 端的后端语言 = 与自托管完全相同的同一份 Node.js / TypeScript 应用。不存在「Cloud 用另一种后端语言」。**

对标基线的事实：同类产品的自托管安装与 Cloud 用的是同一个核心产品，区别不是语言，而是**谁来运维**——自托管是你自己 `docker run`，Cloud 是厂商替你托管同一个 Node 应用。用户访问 Cloud web 端时，后端就是那个 Node.js 应用本身。

因此本项目：
- 一份 `@nomops` 的 Node.js 应用，既是自托管产物，也是 Cloud 上跑的东西。
- 自托管：用户 `docker run` 它。
- Cloud：我们在 k8s / 云上跑它，前面加注册 + 计费 + 租户路由。

Cloud 比自托管**多出来**的「控制平面」（实例编排、计费、多租户路由）是套在这个 Node 应用**外面**的独立编排层，通过网络边界与内核通信。它**不是「web 端后端」**，且属于 Phase 6+，现在完全不碰。将来它用什么语言是很久以后、且与内核解耦的独立决策——**MVP 阶段与对标基线而言，全项目后端只有 TypeScript 一种语言。**

---

两种形态复用同一套共享内核（约 85–90% 代码）。分叉只在最外层。

```
   安装版 self-hosted              Cloud Web 平台
   ├ Docker / npm 部署             ├ 控制平面：实例编排
   ├ License key 解锁企业版         ├ 计费 + 执行配额
   └ DB / Redis 自管               └ 多租户隔离路由
              │                            │
              └──────── 同一套代码 ─────────┘
                          ▼
        ┌────────────────────────────────────┐
        │           共享内核 packages/         │
        │  workflow · core · nodes · server   │
        │  frontend · db                      │
        └────────────────────────────────────┘
```

**实施顺序铁律：先 self-hosted 单实例，Cloud 后加壳。绝不反过来。**

若先做 Cloud，多租户/计费会缠进核心数据模型，之后剥不出干净的安装版。反过来则自然——Cloud 只是在内核前加控制平面。

**唯一必须 Day-1 埋好的东西：归属边界（owner/project）。** 哪怕安装版只有一个 owner，所有 workflow/credential/execution 也要带 `ownerId`（或经 `shared_*` 关联表）。这样 Cloud 把「一个 owner」放大成「N 个租户」时是同逻辑放大，而非重写。详见 `02-DATA-MODEL.md`。

**第二个必须早做的抽象：凭证加密的密钥来源。** 把「取加密密钥」抽成 `EncryptionKeyProvider` 接口。安装版实现为「读本地实例设置」，Cloud 实现为「读 KMS / 每租户密钥」。业务层永远只调接口。

---

## 三、Monorepo 包结构

```
nomops/
├── package.json                 # 根，pnpm workspace + turbo
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── packages/
│   ├── workflow/                # 【层1】引擎抽象，零业务依赖
│   │   └── src/
│   │       ├── interfaces.ts            # INode, IConnection, INodeExecutionData…
│   │       ├── workflow.ts              # Workflow 类：图结构 + 父子节点查询
│   │       ├── node-helpers.ts          # 节点参数解析
│   │       ├── expression/              # 表达式引擎（{{ }} 求值）
│   │       │   ├── parser.ts
│   │       │   ├── evaluator.ts
│   │       │   └── sandbox.ts
│   │       ├── graph/
│   │       │   └── graph-utils.ts       # 拓扑、父/子节点、DAG 工具
│   │       └── run-execution-data.ts    # RunExecutionData 状态结构工厂
│   │
│   ├── core/                    # 【层2】执行引擎 + 节点加载
│   │   └── src/
│   │       ├── execution-engine/
│   │       │   ├── workflow-execute.ts  # ★引擎心脏：栈驱动调度
│   │       │   ├── node-execution-context.ts  # 节点执行时的上下文（getInputData 等）
│   │       │   └── triggers-and-pollers.ts
│   │       ├── nodes-loader/
│   │       │   ├── directory-loader.ts
│   │       │   ├── lazy-loader.ts       # 懒加载
│   │       │   └── load-in-isolation.ts # 隔离加载
│   │       ├── credentials.ts           # Credentials 类：encrypt/decrypt
│   │       └── encryption/
│   │           ├── cipher.ts
│   │           └── key-provider.ts      # ★EncryptionKeyProvider 接口
│   │
│   ├── nodes/                   # 【层3】具体节点
│   │   └── src/nodes/
│   │       ├── HttpRequest/
│   │       ├── Webhook/
│   │       ├── Schedule/        # Cron 触发
│   │       ├── Code/            # 运行用户 JS
│   │       ├── If/             # 分支
│   │       ├── Merge/          # 合并
│   │       ├── Set/            # 字段赋值
│   │       └── ...
│   │
│   ├── db/                      # 数据持久层（Drizzle）
│   │   └── src/
│   │       ├── schema/          # 表定义
│   │       ├── repositories/    # repository 模式
│   │       └── migrations/
│   │
│   ├── server/                  # 服务层：HTTP + 触发器 + 编排
│   │   └── src/
│   │       ├── controllers/     # REST，按领域分
│   │       ├── services/        # 业务逻辑
│   │       ├── triggers/
│   │       │   └── active-workflow-manager.ts  # ★触发器激活/停用
│   │       ├── auth/
│   │       ├── webhooks/        # webhook 入口路由
│   │       ├── queue/           # BullMQ（可选 queue mode）
│   │       └── main.ts          # 启动入口
│   │
│   └── frontend/                # Vue 3 编辑器
│       └── src/
│           ├── views/           # 画布、工作流列表、凭证、执行历史
│           ├── components/
│           │   ├── canvas/      # Vue Flow 画布
│           │   ├── node-view/   # 节点右侧配置面板（由 node schema 驱动）
│           │   └── ndv/         # 节点数据视图（输入/输出）
│           ├── stores/          # Pinia
│           └── api/             # 调后端 REST
│
└── docker/
    ├── Dockerfile
    └── docker-compose.yml       # app + postgres + redis
```

**包依赖方向（只能单向，禁止反向或环）**
```
frontend ──(HTTP)──> server ──> core ──> workflow
                       │          │
                       ├──> db    └──> nodes ──> workflow
                       └──> nodes
```

---

## 四、运行形态

### 单进程模式（默认，安装版起步）
一个 Node 进程包揽：HTTP、webhook 接收、触发器调度、工作流执行。SQLite 存储。零外部依赖。`docker run` 即用。

### 队列模式（queue mode，生产/高并发）
- **main 进程**：HTTP + webhook 接收 + 触发器调度（leader）。收到触发只做「入队」。
- **worker 进程（N 个）**：从 Redis 消费，执行工作流。
- 存储切换到 PostgreSQL，队列用 BullMQ + Redis。

**关键设计约束（Day-1 就要考虑，即使先只做单进程）：**
1. 工作流执行必须能脱离 HTTP 上下文运行（因为 worker 里没有 HTTP 请求）——这正是三层解耦的意义。
2. 定时/轮询触发器**只能由 leader 跑**，否则多 worker 会把一个 cron 触发 N 次。触发器管理必须区分「webhook 型（无状态，任意进程可接）」与「定时型（有状态，仅 leader）」。
3. 执行状态 `RunExecutionData` 必须整体可序列化——入队时序列化，worker 反序列化后继续。这也是引擎用「显式栈」而非「递归」的原因。

### 自托管部署矩阵（对标基线官方，供 Phase 5 参考）

同一份 Node 应用，多种分发方式。用户按需选：

| 方式 | 适用 | 说明 |
|---|---|---|
| npm | 本地开发 / 简单单机 | 用户自管 Node 版本，最轻但要自己维护 |
| Docker（推荐） | 隔离环境、易更新 | 一个镜像含全部依赖，`docker run` 即用 |
| Docker Compose | 生产单机 | app + PostgreSQL + 反向代理(traefik/nginx，TLS) |
| 云平台 | 托管 | AWS / Azure / GCP Cloud Run / DigitalOcean / Hetzner / k8s |

配套配置项（对标基线环境变量思路）：
- 运行模式：`EXECUTIONS_MODE=regular`(单进程) / `queue`(队列模式)
- 数据库：`DB_TYPE=sqlite`(开发) / `postgres`(生产)。MySQL/MariaDB 不做（基线已弃用）。
- License：不加 key = 免费社区版；加 key 解锁企业功能（Phase 5 只做校验骨架）。
- Webhook 可达性：生产走反向代理 + 域名；本地开发可用隧道（cloudflared）临时暴露。

**Cloud 形态不在此矩阵内**——Cloud 是我们自己在 k8s/云上跑这同一个应用 + 外层控制平面，属于 Phase 6+。

---

## 五、请求生命周期（三条主线）

**A. 编辑工作流**
`前端画布 → PUT /workflows/:id → server 校验 workflow 结构 → db 保存 → 若已激活则重新注册触发器`

**B. Webhook 触发执行**
`外部 POST /webhook/:path → server 查到对应 workflow → 构造起始数据 → (单进程) 直接跑引擎 / (队列) 入队 → 引擎执行 → 写 execution 记录 → WebSocket 推进度给前端`

**C. 手动运行（调试）**
`前端点「运行」→ POST /workflows/:id/run（可带 destinationNode 只跑到某节点）→ 引擎执行 → 实时 WebSocket 推每个节点的输入输出 → 前端在 NDV 面板展示`

三条线最终都汇聚到 `WorkflowExecute.run()`。引擎不关心是谁触发的。
