# 04 — 开发路线图

按依赖顺序分 6 个阶段。每阶段结束都应是**可运行、可验收**的状态，不要平行铺开半成品。

---

## Phase 0 — 项目骨架（0.5 周）

**目标**：monorepo 能构建、能启动一个空 server。

- [ ] pnpm workspace + Turborepo 搭好，`tsconfig.base.json` 共享配置
- [ ] 建六个包目录（workflow / core / nodes / db / server / frontend），各有最小 `package.json` 与 `index.ts`
- [ ] `server` 能起一个 Express 实例，`GET /healthz` 返回 200
- [ ] Vitest 配好，一个占位测试通过
- [ ] `docker/docker-compose.yml`：app + postgres + redis（先不用，占位）

**验收**：`pnpm build && pnpm dev` 起服务，`curl /healthz` 通；`pnpm test` 通。

---

## Phase 1 — 地基：数据层 + 节点加载器（1 周）

**目标**：能加载节点、能读写数据库。这两块可并行。

- [ ] Drizzle schema 全表建好（`02-DATA-MODEL.md` 第一节），迁移可跑
- [ ] SQLite + PostgreSQL 双跑通
- [ ] 各实体 repository（含归属过滤）
- [ ] 节点加载器：扫描 `nodes/src/nodes/`，懒加载，`getAllDescriptions` / `getByNameAndVersion`
- [ ] 写 3 个最简节点占位：`Set`、`NoOp`、`ManualTrigger`

**验收**：单测——迁移在两种 DB 都成功；`nodeLoader.getByNameAndVersion('nomops.set',1)` 返回可执行类；跨 project 查不到别人数据。

---

## Phase 2 — 引擎 + 表达式（1.5 周）★最难

**目标**：给一个 workflow JSON，能在无 HTTP/DB 环境下跑完。这是项目成败关键，慢一点没关系，一定要对。

- [ ] `workflow` 包：`Workflow` 类（图结构、父/子节点查询）、`RunExecutionData` 状态工厂
- [ ] 表达式引擎：`{{ }}` 求值 + 沙箱（白名单变量）
- [ ] `WorkflowExecute`：栈驱动主循环、多输入等待表、pairedItem 溯源、错误续跑、部分执行（destinationNode）、取消、hooks
- [ ] `IExecuteContext`：`getInputData` / `getNodeParameter`（自动求值表达式）/ `getCredentials`
- [ ] 补齐核心节点：`If`（分支）、`Merge`（合并）、`Code`（vm 临时沙箱）、`HttpRequest`

**验收**（纯单测，不起服务）：
- 线性流三节点跑通，数据正确传递
- IF 分支：条件真走输出0，假走输出1
- Merge：等两路输入到齐才执行
- 循环拓扑不死锁
- 节点报错：continueOnError 走错误端口 / 否则终止
- 执行到一半序列化 → 反序列化 → 继续跑完，结果一致
- 表达式沙箱拦住 `process`/`require`

---

## Phase 3 — 服务层贯通（1.5 周）

**目标**：从 API 建工作流、手动运行、看结果。第一个「能用」的里程碑。

- [ ] 鉴权：注册/登录/JWT，密码 argon2
- [ ] Workflow CRUD API（Zod 校验 + 结构校验）
- [ ] 凭证系统：加解密（AES-256-GCM + `IEncryptionKeyProvider` 本地实现）、CRUD、test
- [ ] `POST /workflows/:id/run` 手动运行，接引擎
- [ ] WebSocket 推执行进度（引擎 hook → WS）
- [ ] execution 记录落库（`executions` + `execution_data`）
- [ ] `GET /node-types` 返回节点 descriptions

**验收**：curl 全流程「登录→建工作流→手动运行→查执行历史」通；WS 能收到逐节点进度；凭证明文不落库、不出 API。

---

## Phase 4 — 前端画布（2 周）

**目标**：可视化编辑 + 运行 + 看数据。产品成型。

- [ ] Vue 3 + Pinia + Vue Flow 画布：拖拽节点、连线、移动、删除
- [ ] 节点面板：从 `/node-types` 拉列表，按 group 分类，可搜索拖出
- [ ] **节点配置面板（NDV）由 node schema 驱动**：根据 `properties` + `displayOptions` 动态渲染表单控件（string/number/options/collection…）
- [ ] 表达式输入：CodeMirror + `{{ }}` 高亮
- [ ] 运行：点「运行」调 API，WS 实时高亮执行中的节点
- [ ] 数据视图：点节点看它的输入/输出 item（JSON 表格）
- [ ] 工作流列表、凭证管理、执行历史页

**验收**：全程点鼠标完成「拖 Webhook + Set + HTTP → 连线 → 配参数 → 保存 → 运行 → 看每节点数据」。

---

## Phase 5 — 触发器 + 生产化（1.5 周）

**目标**：真正的自动化（无需手动点运行）+ 可部署。安装版完成。

- [ ] `ActiveWorkflowManager`：激活/停用
- [ ] Webhook 触发：激活写 `webhook_entities`，`/webhook/:path` 路由执行
- [ ] Cron 触发：`Schedule` 节点 + 定时器
- [ ] queue mode：BullMQ + Redis，main 入队 / worker 消费；leader 选举（定时触发只 leader 跑）
- [ ] Code 节点独立进程沙箱（替换 vm 临时方案）
- [ ] Dockerfile 打包，`docker compose up` 一键起（app+pg+redis）
- [ ] License key 校验骨架（为企业版功能开关预留，先不实现具体功能）

**验收**：激活 Webhook 工作流，外部请求自动触发；Cron 按时触发；双 worker 下 cron 只触发一次；`docker compose up` 全新环境跑通全流程。

---

## Phase 6+（安装版之后）— Cloud 控制平面

**不在 MVP 内**，路线预留：
- 多租户控制平面：为每租户 provision 实例、路由、隔离
- 计费 + 执行配额网关
- 企业功能：SSO/SCIM、RBAC 权限方案、审计日志
- AI Agent 节点、子工作流、评估

---

## 里程碑总览

| Phase | 产出 | 累计可用度 |
|---|---|---|
| 0 | 骨架 | 能启动 |
| 1 | 数据层 + 节点加载 | 地基就绪 |
| 2 | 引擎 + 表达式 | 能跑工作流（无 UI） |
| 3 | 服务层 | API 能用 |
| 4 | 前端画布 | **产品成型（可演示）** |
| 5 | 触发器 + 部署 | **安装版完成（可发布）** |
| 6+ | Cloud | SaaS 化 |

**总计约 9–10 周**到安装版可发布（单人 + Claude Code 节奏，实际按投入调整）。

关键提醒：**Phase 2 是命门**。引擎不对，后面全白搭。宁可在 Phase 2 多花时间，把那六种拓扑的单测全绿了再往下走。
