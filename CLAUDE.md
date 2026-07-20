# nomops — Claude Code 入口指引

你正在开发 **nomops**：一个节点式工作流自动化平台（对标同类成熟产品）。

## 开工前必须按序读完 docs/

1. `docs/README.md` — 目标、技术栈（已拍板）、术语表
2. `docs/01-ARCHITECTURE.md` — 三层解耦铁律、双形态、monorepo 结构
3. `docs/02-DATA-MODEL.md` — 硬契约：DB schema / workflow JSON / 节点 schema / 执行状态
4. `docs/03-MODULES.md` — 六大模块 + 表达式引擎的开发规范
5. `docs/04-ROADMAP.md` — 分阶段里程碑与验收标准（**按此顺序推进，不跳阶段**）
6. `docs/05-CLAUDE-CODE-GUIDE.md` — 编码规范、测试要求、约束

## 五条不可违反的铁律

1. **三层解耦**：`workflow` 包零业务依赖；引擎能在无 server/无 DB 下单测跑通。
2. **归属边界**：所有 workflow/credential/execution 读操作经带 `projectId` 的 repository。
3. **凭证明文**：解密后的凭证绝不落库/出 API/进日志。
4. **执行状态可序列化**：`RunExecutionData` 必须 `JSON.stringify` 安全。
5. **节点声明式**：加节点 = 写 `description` + `execute`，不在引擎/前端写节点特判。

## 技术栈（已定，不要再权衡）

TypeScript 全栈 · pnpm + Turborepo · Express 5 · Vue 3 + Vue Flow · Drizzle ORM · SQLite→PostgreSQL · BullMQ + Redis · Vitest。

## 现在从哪开始

**Phase 0**：搭 monorepo 骨架，起 `GET /healthz` 空 server，配 Vitest，确认 `pnpm build/dev/test` 三条命令通。然后进 Phase 1。

**命门提醒**：Phase 2（引擎）是全项目成败关键。那六种拓扑的单测必须全绿才算完成——不是可选项。
