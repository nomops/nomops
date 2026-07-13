# 05 — 给 Claude Code 的开发约定

这份文档约束实施过程。开工前先读 `README` → `01` → `02`，再按 `04-ROADMAP` 的阶段推进。

---

## 一、开工前必读顺序

1. `README.md` — 目标、技术栈、术语
2. `01-ARCHITECTURE.md` — 分层铁律、包依赖方向
3. `02-DATA-MODEL.md` — 硬契约（写任何代码前先内化这些结构）
4. `03-MODULES.md` — 当前要做的模块规范
5. `04-ROADMAP.md` — 当前在哪个 Phase、验收标准

**不要跳阶段。** 依赖没就绪就往上写，会返工。

---

## 二、不可违反的架构约束

1. **三层解耦**：`workflow` 包零业务依赖（不 import DB/HTTP/具体节点）；`core` 不碰 HTTP；引擎能在无 server/无 DB 下单测跑通。写代码前自问：这个 import 会不会破坏分层？
2. **归属边界**：所有 workflow/credential/execution 的读操作必须经带 `projectId` 的 repository 方法。禁止裸查全表。
3. **凭证明文**：解密后的凭证数据绝不落库、绝不出 API、绝不进日志。
4. **执行状态可序列化**：`RunExecutionData` 及其所有字段必须 `JSON.stringify` 安全（不放函数、类实例、循环引用）。
5. **加密密钥经 provider**：任何取加密密钥的地方都调 `IEncryptionKeyProvider`，不写死。
6. **节点声明式**：加节点 = 写 `description` + `execute`。不要为某个节点在引擎或前端里写 if-else 特判。

---

## 三、编码规范

- **语言**：TypeScript strict 模式（`strict: true`）。禁止 `any` 泄漏到模块公共接口（内部临时可，但导出的接口要有准确类型）。
- **校验**：所有外部输入（API body、webhook payload、节点参数）用 Zod 校验后再用。
- **错误**：定义清晰的错误类层级（`OperationalError` 可预期 / `UnexpectedError` bug）。执行错误要带够定位信息（哪个节点、哪个 item、哪个参数）。
- **异步**：一律 async/await，不用裸 Promise 链。引擎的可取消操作用 `PCancelable` 或等价 AbortController 模式。
- **命名**：接口 `I` 前缀（`INodeType`），与本文档契约一致，不要自创同义词。
- **依赖注入**：service/engine 通过构造函数注入依赖（repository、loader、keyProvider），便于测试 mock。不要在模块内 `new` 全局单例。

---

## 四、测试要求（硬性）

- **每个模块交付时附单测。** 尤其：
  - 引擎（Phase 2）：六种拓扑的单测必须全绿才算完成，这是验收门槛，不是可选项。
  - 表达式沙箱：必须有「拦截危险访问」的测试。
  - repository：归属过滤的测试（跨 project 查不到）。
  - 凭证：明文不落库、加解密往返一致。
- 引擎测试**不启动 server、不连真实 DB**（用内存或 mock repository）——如果你的引擎测试需要起 server，说明分层被破坏了，回去改。
- 集成测试（Phase 3+）覆盖「登录→建工作流→运行→查历史」主流程。

---

## 五、目录与提交约定

- 每个包内 `src/` 放源码，`src/__tests__/` 或同目录 `*.test.ts` 放测试。
- 一个 Phase 一组 PR/commit，commit message 标明 Phase 与模块，如 `feat(engine): stack-driven main loop [Phase 2]`。
- 每完成一个模块，回到 `04-ROADMAP` 对照验收标准逐条自查，全过再进下一模块。

---

## 六、决策已定，无需再问的事项

以下已拍板，直接执行，不要反复权衡：
- 语言 = TypeScript 全栈（不是 Go/Python）
- ORM = Drizzle；DB = SQLite 起步、PostgreSQL 生产
- 队列 = BullMQ + Redis
- 前端 = Vue 3 + Vue Flow
- 先 self-hosted 单进程，Cloud 后做
- 项目名/scope = `nomops` / `@nomops`
- 节点全名 = `nomops.<name>`

---

## 七、遇到这些情况才停下来问

- 契约（`02-DATA-MODEL.md` 的结构）需要改动且影响多模块时
- 某个安全边界（凭证、Code 节点沙箱、表达式沙箱）拿不准如何隔离时
- 某 Phase 验收标准无法满足，怀疑是设计问题时

其余按文档自主推进。

---

## 八、第一步该做什么

从 **Phase 0** 开始：搭 monorepo 骨架，起一个 `GET /healthz` 的空 server，配好 Vitest。确认 `pnpm build / dev / test` 三条命令都通，再进 Phase 1。

不要一上来就写引擎或画布——地基不稳，上层白费。
