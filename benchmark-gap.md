# benchmark-gap.md — nomops × 基线(n8n v2.31.0) 对标差距报告

## 头部

| 项 | 值 |
|---|---|
| 审查日期 | 2026-07-25 |
| 对标基线 | n8n **v2.31.0** / commit `038d2ca286`（分析笔记 `/Users/guowangkun/ByteMono/n8n-notes/`，16 篇正文 00–130 + 51/52 附录 + `data/` 实测） |
| nomops 当前 commit | `70f46fd`（main，2026-07-25；P0–P10 全完成，P11 节点补差 #48–#54 未动） |
| 方法 | 14 个只读子代理并行分域（每域一篇笔记 + 对应 nomops 包代码），按四态框架逐条判定并带证据锚点；主代理汇总为本报告。 |

**判定图例**：✅已对齐 · 🟡部分（有雏形缺关键点） · ❌缺失（标「未计划」或「backlog #号」） · ⚠️偏离（分「有意偏离(合理)」vs「疑似踩坑(需改)」）。证据锚点格式：`nomops 路径:行 ‖ n8n-notes 篇号/小节`。

**定位原则**：n8n-notes 是「竞品验证过的真相与差距地图」，非 nomops 规范；冲突时以 nomops 自己的架构决策为准。审查只抓三类问题——**踩坑**（偏离验证过的做法有风险）、**缺能力**（基线证明必要而 nomops 缺）、**抢跑机会**（基线自己没做好的差异化窗口）。

### 一句话总览

nomops 的**内核成熟度已远超「对标一个 MVP」的预期**：三层解耦代码级坐实、六拓扑引擎全绿、执行数据冷热拆表、双方言 parity 守卫、动态凭证/实例信任/AI 平台/实例助手等多处**反超基线**。真正的差距**不在"缺功能"，而集中在三条主轴**：①**节点参数动态层缺失**（loadOptions/resourceLocator/fixedCollection）——这是架空整个 P11 节点扩张计划的地基级空洞，被 3 个独立域同时点名；②**若干前端/引擎的"节点特判"违反铁律 5**，元数据已就绪却被硬编码绕过；③**几处安全/健壮性踩坑**（详见各域）。抢跑窗口清晰：`usableAsTool` 自动派生、实例助手 HITL+检查点、CRDT 协同、真隔离表达式引擎。

---

## 按域分节

### 00 · 架构

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 三层解耦·workflow 零业务依赖 | ✅ | `packages/workflow/src` 外部 import 仅 vitest ‖ 00§3 | 铁律1 代码级坐实 |
| core 不碰 HTTP | ✅ | `core/src` 静态 import 仅 `@nomops/workflow`+node 内置；S3 走动态 import `binary-data/s3-binary-store.ts:58` ‖ 00§3 | 引擎静态依赖图零 HTTP |
| 包依赖单向无环 | ✅ | 非法反向 import grep 全空 ‖ docs/01:151 | 四包边界干净 |
| ①图模型前后端共用 | ✅ | 前端运行时用 `ParamInput.vue:4 resolveParameterValue` ‖ 00§4-① | 离线求值/校验不往返服务端 |
| ②执行数据拆表 | ✅ | `sqlite.ts:858 executions` vs `:876 execution_data` ‖ 00§4-② | 列表页不被大 JSON 拖垮 |
| ③执行模式 × 部署形态正交 | 🟡 | `bootstrap.ts:108/109` mode×role；**仅 main/worker 二态** ‖ 00§4-③ | **缺 webhook 独立进程形态**：queue 下 webhook 摄入压在单 leader，无法横扩 |
| ④部分执行 | ✅ | `core/execution-engine/partial-execution.ts` ‖ 00§4-④ | 子图裁剪+脏节点重算 |
| ⑤发布事务性发件箱 | 🟡 | 有 publish_history/trigger_status + leader 重放；**无 publication_outbox**（backlog #40 明注 deferred）‖ 00§4-⑤ | 靠"期望态重放"达成，非事务发件箱；多实例失败重放有洞 |
| ⑥功能模块自带资产+licenseFlag | ⚠️偏离 | license 门在（`license-service.ts:130`）；但无 `modules/` 目录，`controllers/index.ts` 单文件 2992 行 ‖ 00§4-⑥ | 商业门控达成；模块化架构未采用，单巨文件是维护热点 |
| ⑦声明式节点 routing | 🟡 | 引擎在 `routing-executor.ts`；**全库仅 1 个聚合节点消费** ‖ 00§4-⑦ | 有发动机没收成 |

**该域最该动的 3 条**
1. **[缺能力] 无 webhook 独立进程形态** — `bootstrap.ts:109` role 仅 main/worker，backlog 与"不做"清单均未提及=真盲区；高 webhook 吞吐时 leader 成瓶颈。改成本最低（role 联合类型加 `'webhook'` + 复用 webhook 路由）。→ 建议新增。
2. **[抢跑] 声明式 routing 引擎已成但未收割** — `routing-executor.ts` 生产级却仅 1 节点消费；基线靠 JSON routing 规模化到 400+ 节点。→ 在手写 app 节点前先立项「声明式集成节点框架」。关联 P11 之后 app 集成排期。
3. **[债务] 单巨文件抵消决策⑥** — `controllers/index.ts` 2992 行/117KB（内含 42 处 section 缝）。→ 按现有缝机械拆分为按域子路由（低风险）。→ 建议新增重构项。

**待确认**：publish commit 与触发器注册间 leader 崩溃是否 100% 被 `activeWorkflows.init()` 重放覆盖（缺显式测试）；`@aws-sdk/client-s3` 列 core 依赖是否有意（倾向合理）。

---

### 10 · 数据模型（`packages/db`）

两方言各导出 **80 张表**（`schema-parity.test.ts` 守漂移），50 迁移（0000–0049）。

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| ①一切资源归属 Project | ✅ | `pg.ts:495/502/587` projects/relations/shared_*；`repositories.ts:490 findById(id,projectId)` innerJoin ‖ 结论1 | 统一抽象完整，铁律2 护栏 |
| ②执行冷热拆表 | ✅ | `pg.ts:721 executions` vs `:737 execution_data`(workflowData 快照) ‖ 结论2 | 历史执行不受后续编辑影响 |
| ③版本快照（非 diff） | ✅ | `pg.ts:541 workflow_versions`；`:206 agent_history` ‖ 结论3 | 快照式，展示层算 diff |
| ④双方言 parity | ✅ | `schema-parity.test.ts:8` 守表+列集合 | 强 |
| 二级漏斗 Insights / 动态凭证三表 | ✅ | `pg.ts:1021 insights_raw→:1037 by_period`；`:617/631/647 dynamic_credential_*` ‖ 结论2 | 与 n8n 对应表一一对应（#39/#46） |
| 执行 pruning | ⚠️偏离(合理) | `repositories.ts:1374` 时长+条数并集，只删终态；无 `deletedAt` 软删 ‖ 建模④ | 硬删+终态保护，有意 |
| binary 生命周期 | ⚠️偏离(合理) | 无 binary_data 表；`core/binary-data/binary-store.ts:16` FS/内存/S3 三后端 ‖ 全表清单 | 有意不做 DB 后端 |
| **发布/激活走 outbox** | 🟡 | 有 publish_history/trigger_status/credential_dependency；**无 workflow_publication_outbox** ‖ 结论4 | backlog #40 明列未做；多实例发布事件最终一致缺兜底 |
| **Data Tables 物理表** | ⚠️偏离(踩坑) | `pg.ts:707 data_table_rows.data` 是 **JSON blob**，无 data_table_column/动态物理表 ‖ 结论5 | 丢失真实列索引/SQL 能力；叠加节点 #54 未做，近乎空壳 |
| 子流依赖图 workflow_dependency | ❌ | 无该表 ‖ 全表清单 | backlog #40 明列未做；影响子流级联删除保护 |
| OAuth Provider（5 表） | ❌未计划 | 无；MCP OAuth token 存 settings(#25) | niche |
| executions PK 用 uuid | ⚠️偏离 | `pg.ts:724` uuid 非自增 int ‖ ER1.3 | 丢失顺序插入局部性 |

**该域最该动的 3 条**
1. **[踩坑] `waitTill` 无索引，唤醒是全表顺扫** — WaitTracker 每 10s `findDueWaiting`(`repositories.ts:1298`)，executions 仅 `(workflow_id,created_at)` 一个索引（`pg.ts:734`），status/wait_till 无索引；n8n 明确对 waitTill 建索引。执行表变大后 leader 每 10s 顺扫=隐性退化。→ 加 `(status, wait_till)` 部分索引（一张迁移，S）。→ 建议新增。
2. **[缺能力] 发布缺事务发件箱（结论4 只做一半）** — 无 publication_outbox（#40 deferred）；多实例仅对"调度触发"用 scheduled_tasks 租约代偿，webhook/发布事件跨实例最终一致无兜底。→ 补 outbox 表+投递 worker，或文档明确"单 leader 承载发布"。→ 承接 #40 尾巴。
3. **[偏离] Data Tables JSON 列非物理表（结论5）** — 丢失列索引+SQL 查询能力，叠加节点 #54 未做。→ 若要真数据表能力需按结论5 重做并独立立项；否则文档标注"轻量 KV 行存"以免误期。→ 对应 #54。

**待确认**：迁移记录表名（疑 `__drizzle_migrations`）；variables 仅 project 级、无实例全局；webhook_entities 无动态路径段字段（属 110 域）。

---

### 20 · 功能矩阵（广度覆盖）

nomops 覆盖广度极高，大量 n8n **EE 收费功能被 nomops 免费给**（执行 metadata 过滤/标注、Debug in editor、Insights 仪表盘、evaluation、folders）。以下只列关键差距行（完整矩阵见各专域）。

| 功能域 | 状态 | 证据 | 备注 |
|---|---|---|---|
| 画布/NDV/表达式/PinData/部分执行/标签归档/版本/发布管线/收藏 | ✅ | #4/#8/#17/#19–21/#34/#40 等 | 编辑体验核心齐 |
| 触发器全类型 + DB 调度器 + 并发控制 | ✅ | Webhook/Schedule/Polling/Wait + #38 | 多实例租约去重 |
| 凭证/共享/外部密钥/**动态凭证** | ✅ | #12/#23/#46 | 动态凭证反超基线 |
| SSO(SAML/OIDC/LDAP)+SCIM+自定义角色+审计+Git/多环境+Public API v1 | ✅ | `ee/*` + #26/#28/#29/#36/#42 | 企业身份栈完整 |
| 日志流/Prometheus/OTel/Insights 预聚合 | ✅ | #24/#27/#39 + `metrics.ts` | 零依赖手搓 |
| AI Assistant/AI Builder/Agents 平台/MCP/evaluation | ✅ | #44/#45/#25/#31 | 把基线托管付费做成自托管 BYO-key |
| **动态节点参数（loadOptions/resourceLocator）** | ❌未计划 | grep 全空 ‖ 矩阵 H（社区**免费**） | **见全局🔴#1** |
| **多人协作 presence** | ❌未计划 | grep presence/collaborat 全空 ‖ 矩阵 D（社区免费） | 团队项目已多人同库，同开工作流互不可见易覆盖 |
| Code 节点 Python | 🟡 | 仅 JS，无 pyodide/python ‖ 矩阵 B（社区双语言） | 数据科学用户迁移即卡 |
| 工作流可视化 diff | ❌未计划 | 有 history 无 diff ‖ 矩阵 A（EE） | 低优先 |
| 执行数据脱敏 redaction | ❌未计划 | 无 ‖ 矩阵 B（EE） | 合规类真空白 |
| Worker 监控视图 / 多 main HA | 🟡 | 队列+leader✅；active-active❌ Worker view❌ ‖ 矩阵 E | HA/运维面缺 |
| 内置集成节点广度 | 🟡(计划#48-54) | 核心~29+集成 8≈37 vs ~438 ‖ 矩阵 H | Core Node 缺 34 已列 #48-54 |

**该域最该动的 3 条**
1. **[缺能力·前置] 动态节点参数（loadOptions/resourceLocator）缺失，会架空整个 P11 集成节点计划** — grep 全空；基线社区**免费**；#48-54 与未来 355 app 节点全依赖"参数联动查远端资源"。→ 在 P11 动工**之前**先补 `dynamic-node-parameters` 端点 + 节点 loadOptions/RLC 契约（引擎侧声明式，符铁律5）。→ 建议新增（P11 前置）。
2. **[缺能力] Code 节点无 Python** — 与基线双语言沙箱不对齐；task-runner 式沙箱越晚补越贵。→ 评估 pyodide 或独立 runner 进程，先立项。→ 建议新增。
3. **[缺能力] 多人协作 presence 真空白** — 基线免费的 table-stakes；WS 通道已有，加轻量 presence 广播（谁在看哪个工作流）即可，成本低。→ 建议新增。

**待确认**：CLI import/export 是否有意用 Git+API 替代；OAuth1 是否有意略过；Git/source-control 的 backlog 编号归属；Chat Hub 嵌入式 widget 是否计划。

---

### 30 · 执行引擎（`packages/core` · `packages/workflow`）

六拓扑单测全绿（`workflow-execute.test.ts:146/171/204/256/341/387`），项目命门已达标。

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 栈驱动非递归 + 多输入等待表 | ✅ | `workflow-execute.ts:158/122-147` ‖ §1 | 状态整体可序列化，铁律4 落地 |
| 部分执行（dirty 裁剪） | ✅ | `partial-execution.ts:79/36/101` ‖ §2.1 | n8n 评 ★★★★，此块成熟 |
| — 环处理/Loop 迭代态 | 🟡 | 无 cycle 专项；Loop 靠 contextData 不在 previousRunData 内 ‖ §2.1 | 含 Loop 子图部分重跑无法重建迭代态 |
| 队列模式 + leader 选举 | ✅ | `execution-queue.ts:23/65`、`leader.ts:36`、`worker.ts:9` ‖ §2.3 | 三层解耦守住 |
| 定时触发去重 | ⚠️偏离(更强) | `scheduler-service.ts:96 claimTask(leaseEpoch)` 乐观锁；所有实例都跑循环 ‖ §3 | 弃"只 leader 起定时器"，修复 leader 切换漏触发，比基线旧设计更稳 |
| 暂停/恢复 + 状态全序列化 | ✅ | `Wait.node.ts:18`、`execution-service.ts:797/882`、`execution-interfaces.ts:77` ‖ §2.2 | waitTill 到点扫描，resumeToken 进可序列化态 |
| **Code 节点沙箱** | ✅ | `Code.node.ts:34 runInChildProcess`：spawn 空 env、无 require、超时 SIGKILL、IPC 深拷 ‖ §2.4 | **踩坑已避**：进程级隔离，正是 n8n 弃 vm2 的路子 |
| — 沙箱成熟度 | ⚠️偏离(合理) | 每次执行 spawn 新进程；仅 JS ‖ §2.4 | 无常驻 runner 池，规模下有 spawn 开销 |
| 错误续跑/pairedItem/取消/hooks | ✅ | `workflow-execute.ts:328/539/167`、`execution-service.ts:919` ‖ #17/#21/#2 | 三态错误、等长配对、注册表直达 |
| **AbortSignal 贯通** | ⚠️偏离(踩坑) | 全域无 AbortController（grep 0）；`workflow-execute.ts:438` 注释"被抛下的 promise 仍在后台跑" | 取消/超时只让引擎不再等，节点内 HTTP/长任务仍跑完=在飞 I/O 泄漏 |
| **声明式 routing DSL** | 🟡 | `interfaces.ts:159 IHttpRequestDeclaration` 仅 method/url/qs/body/headers ‖ §4(★★★★) | 缺分页/postReceive/preSend/二进制——生态规模化短板 |

**该域最该动的 3 条**
1. **[缺能力] 声明式 routing DSL 只做单请求，缺分页与收/发变换** — `routing-executor.ts` 无分页循环/postReceive/preSend；n8n 视其为"集成生态能否规模化"的决定因素。当前凡涉翻页/响应转换/二进制的 SaaS 节点都得退回写 execute()。→ DSL 扩 `pagination` + `postReceive`/`preSend` 钩子。→ 建议新增。
2. **[踩坑] 取消/超时不贯通 AbortSignal，在飞 I/O 泄漏** — 取消卡在慢 HTTP 的节点时，底层请求继续占连接/内存；配合 concurrency-gate 会侵蚀实际并发余量。→ 把 AbortSignal 经 `additionalData.httpRequest` 贯通到 fetch，cancel/超时即 abort 网络 I/O。→ 建议新增。
3. **[踩坑·次要] 部分执行无环处理，Loop 子图重跑迭代态丢失** — 对含 Loop 的图做 destinationNode 重跑时干净上游的 Loop 游标无法重建；不崩但语义有洞。→ 部分执行遇 Loop 环内节点强制纳入脏集整段重跑，或显式文档化。→ 关联 #5。

**待确认**：**WaitTracker 未 leader 门控**（`bootstrap.ts:340` 对所有 main 实例 start，非 isLeader 门控），与 resume `status!=='waiting'→409` 状态守卫之间有 TOCTOU 窗口，理论上可双唤醒——需确认 DB 层是否 compare-and-set 兜住；声明式 DSL 是否有意只做简单 REST；Code 沙箱是否规划常驻 runner 池。

---

### 40 · 商业化 / license 门控（`packages/server`）

免费/收费哲学**与基线高度对齐且纪律更严**（13 个 license flag 全属身份/安全/治理/devops，无一是引擎/节点/API/并发能力位）。

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 能力免费·治理收费 | ✅ | `license-service.ts:23-37`（13 flag 全治理类）‖ §1.2 | 社区版零回归；并发闸门免费 |
| 只登记"有强制点"的 flag | ✅强于基线 | `license-service.ts:16-37` 注释 | n8n 有声明未消费的空 flag，nomops 明文拒绝 |
| 端点级 + 逻辑级门 | ✅ | `requireFeature` ~24 处；`quota-service.ts:80` 等内联 | 未授权 403 |
| 配额哨兵（-1=不限） | ✅ | `license-service.ts:139-155` | 超限 402 |
| 证书离线验签 + 公钥钉死 | ✅强于基线 | `license-cert.ts:107-149` 签原始字节；`:16-28` 编译进产物无 env 覆盖 | 不 phone-home，更自托管友好 |
| HTTP 语义分层 402/429/503 | ✅ | license/quota/concurrency 三处 | 区分清晰 |
| 模块级门（整块不加载） | 🟡 | ee 路由抽出，但模块/实体/迁移恒加载 ‖ §4 | 服务端裁决已足够，非安全缺口 |
| 前端 enterprise.* 统一布尔图 | 🟡 | `/license`+`/security`+`/about` 分散 ‖ §4 | 无统一 map，Vue 侧守卫待确认 |
| **证书吊销/续期** | ❌ | `payload.id` 标注"吊销用"但无消费；`activeCert()` 只查时间窗 ‖ §4 | 退款/泄露只能等过期或轮换公钥（废所有证书） |
| **published/activeWorkflows 配额** | ❌未计划 | 仅 `metrics.ts:35 countActive()` 做指标无配额门 ‖ §3 | n8n 主计费维度；nomops 选按执行次数 |
| 执行配额 check-increment 竞态 | 🟡踩坑 | `quota-service.ts:78-91` 自认注释 ‖ 08§4 | queue 多 worker 会超发 |
| 支付宝订单式（非订阅） | ⚠️有意偏离 | `alipay-provider.ts` RSA2；`IPaymentProvider` 抽象留 Stripe 口 | 支付宝周期扣款需特批 |
| Cloud 计费编排 | ✅有意·范围外 | `/internal/usage` 度量桥，自托管 404 | 多租户/计费在 nomops-cloud |

**该域最该动的 3 条**
1. **[缺能力] License 无吊销/续期** — `payload.id` 注释"吊销用"却全仓无消费；退款/密钥泄露唯一手段是等过期或轮换公钥（同时作废所有存量证书）。→ 经 `/internal` 桥从控制平面下发 cert-id 黑名单，`activeCert()` 增查；或改"短有效期+自动续签"。→ 建议新增。
2. **[踩坑] 执行配额 check-increment 竞态** — BullMQ queue 模式多 worker 并发稳定超发配额=按量计费漏收点。→ 原子自增（ON CONFLICT RETURNING 后比对上限 / Redis 原子计数），开 queue 计费前收口。→ 建议新增。
3. **[决策点] 无 activeWorkflows 配额** — 已有 countActive() 却无配额门；若 Cloud 要按"活跃自动化数"分层则补 `assertQuota`，若只按执行次数则显式记录该决策避免误判遗漏。→ 决策点。

**待确认**：前端是否有统一 enterprise 门+路由守卫；AI 托管是否收费（仅 BYO key 则不适用）；folders/variables 是否有意免费（n8n 均收费）。

**亮点**：`license-service.ts:16-37` 明文拒绝登记"配了不生效"的空 flag，比 n8n 更克制，值得保持。

---

### 50/51/52 · 节点生态（`packages/nodes` · `packages/frontend`）

nomops **37 个注册节点**（`manifest.ts` 静态 29 + `integrations.ts` 声明式 8）vs 基线 562。

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| ①面板一级分类**标签** | ✅ | `NodePanel.vue:40-48` 七类 ‖ 50§1.2 | 标题/文案对齐基线 RegularView |
| ①分类**成员判定**=前端硬编码类型清单 | ⚠️偏离(踩坑) | `NodePanel.vue:43-46` transform 只匹配 `['set','code','noOp']` 等 ‖ 50§2 | **#5 已交付的 Switch/Filter/SplitOut/Aggregate/Loop 落不进抽屉，只能搜索找到**；元数据就绪却被特判绕过（违铁律5） |
| 节点描述缺 codex（categories/alias） | ❌未计划 | `interfaces.ts:227` 只有 `group: string[]` ‖ 50§2 | 硬编码根因：Flow 与 Data transformation 的 group 都是 transform，无法区分 |
| ②声明式 DSL 双风格 | ✅ | `integrations/declarative.ts:8` routing 工厂 + 核心编程式 execute ‖ 50§7.1 | 架构对齐，强项 |
| ③resource×operation 建模 | 🟡 | `integrations.ts:22-43` Slack 仅扁平 operation，**无 resource 维度** ‖ 52 | 只做扁平一档，未建 resource 分组 |
| DSL 控件集 | ⚠️偏离(缺口将卡应用节点) | `interfaces.ts:136-152` 仅 10 类型+`rows` ‖ 50§7.3 | **缺 fixedCollection(基线1007)/resourceLocator(583)/loadOptionsMethod(1826)** |
| **④usableAsTool 自动派生** | ❌未计划 | 全仓 0 处；仅 `HttpTool.node.ts:12` 手写单点；但 ai_tool 端口机制已具备（`AiAgent.node.ts:49`）‖ 50§7.4 | **竞品最难复制的护城河，连 backlog 都没有** |
| ⑤typeVersion 多版本 | 🟡(基建在未启用) | 类型/loader 支持版本 key（`node-loader.ts:56/109`），但全部节点 `version:1`，一 type 一 description | 无法像基线 nodeVersions 按版本分叉行为 |
| ⑥规模·Core Nodes | 🟡(全在 backlog) | 覆盖 19/53，缺 34 → #48-#53 逐批；#54 主动弃 ‖ node-catalog-gap §1 | 非"缺失"，属分期 |
| ⑥规模·AI/RAG 101 节点 | ❌已知未编号 | 覆盖~6，缺~101 ‖ §3 | P11 排除"走独立框架"但无 backlog 编号；RAG 全家桶整体空白 |
| 前缀去 n8n 命名 | ✅有意偏离 | 全部 `nomops.` 前缀 | 符仓库铁律 |

**该域最该动的 3 条**
1. **[抢跑] `usableAsTool` 自动派生——存量节点一键变 AI 工具** — 基线靠它把 260 个 base 节点免费变 Agent 工具；nomops ai_tool 端口+supplyData 基建已在（`AiAgent.node.ts:45-49`）。→ `INodeTypeDescription` 加 `usableAsTool?: boolean`，loader/manifest 层对置位节点自动克隆为 `*Tool` 变体；8 个声明式集成+HttpRequest 可一次性全变 AI 工具。ROI 最高的护城河。→ 建议新增（应立独立编号）。
2. **[踩坑] 节点面板分类改元数据驱动，清掉前端类型特判（违铁律5）** — `NodePanel.vue:43-46` 硬编码致 #5 节点落不进抽屉。→ `INodeTypeDescription` 增 `categories/subcategories`（或 `panelCategory`），面板改读元数据；这是 #48-53 每批新节点自动上架面板的前置。→ 建议新增（并入 #48 前置）。
3. **[缺能力] 补 DSL 三控件 fixedCollection/resourceLocator/loadOptionsMethod** — 基线用量 1007/583/1826，是应用节点标配与"体验分水岭"。→ 属性类型扩容 + 后端 loadOptions 端点。启动 355 应用节点框架前必须落地，否则 resource×operation 与真实 SaaS 节点都做不出。→ 建议新增（应用集成框架前置）。

**待确认**：AI/RAG 101 节点无 backlog 编号（多模型 Chat Model 最高优先）；社区节点真实包发现/安装通路是否落地（`node-loader.ts loadAll` 疑占位）；typeVersion 行为分叉是否规划；`packages/server/.nomops/source-control/` 下 packages 副本是否致节点重复注册。

---

### 60 · NDV 参数配置系统（`packages/frontend` · `packages/workflow`）

参数类型 first-class 覆盖 **10/24**；通用设置与表达式系统对齐良好，复合控件与动态选项是主要短板。

| 对标点 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 参数类型枚举 | 🟡 | `interfaces.ts:136-146`（10 种）‖ 60§1（24 种） | 基础控件档覆盖 |
| boolean/options/multiOptions | ✅ | `ParamInput.vue:425-479` | 自定义下拉+多选芯片，视觉到位 |
| json/dateTime/color/notice | ✅ | `ParamInput.vue:509-527` | notice 渲染紫色 Tip 条 |
| **fixedCollection** | ❌ | grep 全空 ‖ 60§1 | 分组重复行容器完全没有——#48-53 多数节点会撞墙 |
| number 校验（min/max/precision） | ❌ | typeOptions 仅 `rows` ‖ 60§1 | 无数值约束 |
| **displayOptions show/hide** | 🟡 | `display-options.ts:8-32` 仅 `includes()` 等值 ‖ 60§2 | 缺 `_cnd` 操作符（gte/lte/between/regex/exists） |
| ↳ `@version` 门控 | ❌ | `NdvModal.vue:180` 仅被动版本注记 ‖ 60§2/§7.3 | **无版本化参数面**——节点演进即破坏存量工作流 |
| ↳ 受控值为表达式时误隐藏 | ⚠️踩坑 | `display-options.ts:16` includes 判否→隐藏（基线是默认显示） | 表达式态字段会被误隐 |
| **loadOptions 动态选项** | ❌ | grep 全空，无 server 端点 ‖ 60§4 | 基线定性"体验分水岭"（注：#46 动态凭证与此无关） |
| resourceLocator / resourceMapper | ❌ | grep 全空 ‖ 60§1 | 复合控件缺 |
| filter / assignmentCollection | ⚠️踩坑 | `ParamInput.vue:243` 按 `name==='conditions'` 分流、`:498` 键值行 ‖ 60§1 | **伪装进 collection 特判（违铁律5）**，无 and/or 组合器、无类型校验 |
| 通用设置（6 项） | ✅ | `NdvModal.vue:306-351`、`node-settings.ts` ‖ 60§6 | AlwaysOutputData/ExecuteOnce/RetryOnFail/OnError 三态/Notes 全齐 |
| 表达式系统 | ✅ | `ExpressionInput.vue`（真 CodeMirror）+ `$fromAI`(#19) ‖ 60§3 | 高亮+补全+拖拽 pill+实时预览 |
| 数据视图 | 🟡 | `DataPane.vue` schema/table/json 3/6 ‖ 60§5 | 缺 binary/html/ai 视图 |

**该域最该动的 3 条**
1. **[缺能力] loadOptions 动态选项通道** — grep 全空；基线定性"体验分水岭"。→ 加 `typeOptions.loadOptionsMethod/loadOptions/loadOptionsDependsOn` + 一条"以用户凭证代查"的 POST 端点 + 前端异步下拉。这是 resourceMapper/RLC list 模式的公共地基，应先建。→ 建议新增。
2. **[踩坑] filter/assignment 复合控件被伪装进 collection 特判（违铁律5）** — `ParamInput.vue:243/498` 按参数名分流。→ 提升为真 DSL 类型 `filter`/`assignmentCollection`（顺带补 `fixedCollection`），用 type 分发替代 name 特判。→ 建议新增。
3. **[抢跑/缺能力] displayOptions 缺 `@version` 门控 + `_cnd` 操作符** — 基线定性"从第一天就要有"；越早加改造面越小（存量节点 description 已在增长）。→ `IDisplayOptions` 值支持 `{_cnd:{gte/regex/exists…}}`，`isPropertyVisible` 增 `@version` 门控与"受控值为表达式默认显示"分支。→ 建议新增。

**待确认**：代码编辑器族（codeNode/js/html/sql）属二档工作量，是否有意用 json/textarea 承载；binary/html/ai 数据视图是否随 #50 排期；`IDisplayOptions` 是否 docs/02 显式声明"只做等值"（若是则记有意偏离，但与 60§7.3"必须有"冲突，倾向判缺失）。

---

### 70 · 表达式引擎（`packages/workflow/src/expression`）

$ 变量集约 **14/~40**；扩展方法 **0/108**；核心语义正确，但沙箱与同构预览是重大缺口。

| 对标点 | 状态 | 证据 | 说明/缺口 |
|---|---|---|---|
| `{{ }}` 单表达式保原值/混合拼串 | ✅ | `evaluator.ts:159-167` ‖ §1 | 语义正确，测试覆盖 |
| `{{ }}` 切块用真解析器 | ⚠️偏离(踩坑-低) | 仅正则 `TEMPLATE_RE` `evaluator.ts:49,164` ‖ §2 | 对象字面量含 `}}` 被误切；无 `\{{` 转义 |
| **求值引擎隔离等级** | ⚠️**偏离(踩坑-高危)** | `new Function` `sandbox.ts:58` ‖ §3「第一天就应按 vm 设计」 | 走了笔记明令避开的 legacy 路线，且**弱于** n8n legacy（后者有 AST PrototypeSanitizer） |
| **沙箱能否拦逃逸** | ❌**可逃逸(已 PoC)** | 正则 denylist `sandbox.ts:6-25`；`constructor`/`Function` 被 `NOT_SHADOWABLE` 显式排除 `:53` ‖ §4 | `({})['con'+'structor']['con'+'structor']('return thi'+'s')().process.platform` → 实测返回 `"darwin"`，触达真实 process/env |
| 逃逸测试覆盖 | 🟡假信心 | `expression.test.ts:65-85` 7 条**全是连续字面量** | 未覆盖拼接/计算属性绕过与死循环 |
| **执行超时/内存限制** | ❌缺失 | `sandbox.ts` 无 timeout，`new Function` 同步执行 ‖ §3「死循环挂死 worker」 | `{{ while(true){} }}` 挂死 BullMQ worker 并发槽 |
| 前后端同构「预览即真值」 | ❌缺失 | 前端未 import `resolveParameterValue`（`ExpressionInput.vue`）‖ §9 | 无实时预览；补全是手工镜像 8 项 `$` 常量 |
| pairedItem 跨节点血缘 | ✅(#21) | `paired-item.ts:52-84` ‖ §6 | 递归回溯+断链回退，诚实声明 v1 边界 |
| `$fromAI` | ✅抢跑(#19) | `from-ai.ts` ‖ §8 | collect/provided 双模，与基线机制一致 |
| `$secrets` 不进引擎 scope | ⚠️偏离(合理) | 仅前端 `CredentialExpressionField.vue:6` 物化 ‖ §5 | 更安全（密钥不入 eval）但受限 |
| **Luxon + 扩展方法** | ❌缺失 | grep `luxon`/`DateTime`/`toDateTime` 零命中；`$now` 是字符串 ‖ §7 | 0/108 扩展方法；`$now.plus()`/`.isEmail()`/`.first()` 全报错 |

**该域最该动的 3 条**
1. **[踩坑·高危] 表达式沙箱可逃逸 + 无超时** — 正则 denylist（`sandbox.ts:6-25,58`）被 `['con'+'structor']` 击穿，PoC 实测从工作流参数读到真实 `process.env`；求值跑在**主 worker 进程**（env 含 DB URL/密钥）；叠加无 timeout→死循环挂死队列槽。沙箱自称拦"半可信输入"却失守，且低于 n8n legacy。→ 弃 `new Function`+正则，改真隔离：**复用 Code 节点已验证的子进程 runner**（`Code.node.ts:34-68`），或至少 `node:vm.runInContext`+`{timeout}`。→ 建议新增（安全项，最高优先）。
2. **[缺能力] 无 Luxon + 0 扩展方法** — `{{ $now.plus({days:1}) }}`/`.isEmail()`/`arr.first()` 全报错；DX 与基线断层。→ 接入 Luxon（`$now/$today` 改 DateTime）+ 首批高频扩展方法（需 AST 改写把 `x.method()` 路由到 `extend()`，与隔离改造合并做）+ `.doc` 元数据。→ 建议新增。
3. **[缺能力/抢跑] 前端无同构预览** — 引擎已在 workflow 包、天然可跑浏览器（抢跑窗口现成）。→ 把 `resolveParameterValue` 接进 NDV 做实时预览，补全升级为按运行数据解析真实字段+方法，高亮加 pending 中性态。→ 建议新增。

**待确认**：**威胁面升级点**——未追溯节点参数是否可能被运行期不可信数据（webhook body）拼进表达式串；若能，逃逸从"恶意编辑者"升级为"远程未授权"（即便仅编辑者可写，多租户 Cloud 下低权成员窃取宿主 env 仍属高危）。`$secrets` 物化路径是否真绕开 eval 待读 secrets-service。

---

### 80 · 凭证体系（`core` · `server` · `nodes` · `db`）

铁律3 落地**超越基线**（连脱敏值都不返回），动态凭证反超；但加密密钥来源与 OAuth 多实例是踩坑，注入 DSL 受限。

| 对标点 | 状态 | 证据 | 说明/缺口 |
|---|---|---|---|
| ⑤API 永不返回明文(铁律3) | ✅**超越** | `credential-service.ts:22-29 ICredentialView` 无 data；无 `GET /credentials/:id` 取值端点 ‖ §9 | 比基线更严：连脱敏值都不返回，前端凭 schema 渲染 |
| ⑤getDecryptedData 唯一 choke point | ✅ | `credential-service.ts:68-86`；唯一调用 `execution-service.ts:667` ‖ §6 | refresh→动态解析→$secrets 全在此；错误消息打码注入值 |
| ⑤共享「能用不能看」 | ✅ | `credential-service.ts:170`；`sharing-service.ts:53` ‖ §9 | credential:user 仅执行注入；owner 才可改秘密 |
| ④加密 GCM + provider | ✅ | `cipher.ts:5` aes-256-gcm；`key-provider.ts:6` IEncryptionKeyProvider ‖ §5 | 认证加密优于基线遗留 CBC；provider 抽象到位 |
| ⑦动态凭证(isResolvable) | ✅**抢跑+** | `dynamic-credential-service.ts`（table/http/user_entry+批量导入+审计）‖ §9 | 按 subject 运行时解析，choke point 切入，引擎零改；较基线落地更完整 |
| ③OAuth2 授权码流程 | ✅ | `oauth2-service.ts:49-123`；state 读即销毁 `:79` ‖ §4 | authorization_code 完整，token 不出 API |
| **④加密密钥入库 + 无信封/轮换** | ⚠️**偏离(踩坑)** | `bootstrap.ts:84-98`（密钥存 DB settings，无 env 覆盖）；`cipher.ts:7` 单 DEK 无 keyId ‖ §5/§10.3 | **密钥与密文同库**→DB dump 同泄；换密钥即全量密文不可解；基线明言"第一天按信封设计" |
| **③OAuth2 state 多实例** | ⚠️**偏离(踩坑)** | `oauth2-service.ts:29,75` 进程内 Map ‖ §4 | queue/多实例下 auth 与 callback 落不同进程→连接失败 |
| **③刷新并发锁** | ❌踩坑 | `oauth2-service.ts:130-171` 无 dedup/锁 ‖ §4 | queue 多 worker 同刷一 token，轮换型 provider 双刷竞态互相作废 |
| ③PKCE / clientCredentials | ❌缺失 | 前端 `credential-types.ts:108` 提供选项 vs 后端 `oauth2-service.ts:90` 仅 authorization_code ‖ §4 | **UI 声明了后端不兑现**：选 PKCE 静默退化 |
| ①注入桶 + authenticate 位置 | 🟡/⚠️踩坑 | `routing-executor.ts:97-103` 仅 header/query/path；`integrations.ts:20` credentialInjection 绑**节点**非**凭证** ‖ §2/§3 | 无 body/basic 桶、无函数式 authenticate（digest/OAuth1/HMAC 不可实现）；每节点各写一遍不复用 |
| ②test 连接请求 | 🟡 | `credential-test.ts:129-269` ~30 类硬编码 switch ‖ §8 | 铁律3 干净，但非声明式、不复用 routing、OAuth 类不覆盖 |
| ⑦通用认证凭证悬空 | ❌ | `httpHeaderAuth/httpBasicAuth/httpDigestAuth/oauth1Api` 无运行时消费者（grep 空）‖ §7 | HttpRequest 节点零 credential 引用；是前端悬空元数据 |
| ⑥凭证类型规模 | 🟡 | `credential-types.ts` 65 类（20 OAuth2）vs 基线 441 ‖ §1 | 精选子集（预期内）；真差距是新增边际成本非趋零 |

**该域最该动的 3 条**
1. **[踩坑] 加密密钥入库 + 无信封/轮换** — `bootstrap.ts:84-98`（密钥存 DB settings）+ `cipher.ts:7`（单 DEK 无 keyId）；本域最大安全背离，恰是基线点名"第一天就要做"的一条。→ (a) 加 `NOMOPS_ENCRYPTION_KEY` env/文件来源 + 库内不一致时报错（廉价，把密钥挪出库）；(b) 密文加 `keyId:` 前缀 + DEK 信封包裹，打开轮换路径。→ 建议新增。
2. **[踩坑] OAuth2 多实例/queue 双重失效** — 进程内 pending Map（auth/callback 亲和性）+ 刷新无并发锁（轮换型 provider 双刷竞态）；nomops 已有 BullMQ queue=真实生产隐患。→ pending state 挪 Redis/DB（TTL+读即销毁）；刷新加进程内合并 + Redis/DB 租约锁。→ 建议新增。
3. **[缺能力] 注入 DSL 受限 + UI 悬空能力** — 仅 header/query/path、绑节点非绑凭证、无函数式兜底；连锁使 digest/OAuth1/PKCE/clientCredentials/generic-auth 全不可用（声明未兑现）。→ 注入模板上移到凭证类型（一次声明）；补 body+basic 桶与可选函数式 authenticate；未实现的 PKCE/clientCredentials/digest 选项**要么实现要么从 UI 摘除**（避免误导用户建出不工作的凭证）。→ 建议新增。

**待确认**：nomops 是否设计上支持 queue/多实例下 OAuth Connect 与刷新（若定位单实例装机则第2条降级为已知限制，但 queue 代码已存在，倾向按踩坑处理）；OAuth token 交换/http-resolver 出站请求（用户自填 URL）是否有别处 SSRF 兜底（凭证链路未见，倾向缺失）。

---

### 90 · AI 运行时（`packages/nodes` · `packages/server`）

**总判定：产品面持平偏领先，引擎地基落后。** 聊天面/Agents 平台/实例助手 HITL+检查点/MCP 三向/成本核算的"功能格子"几乎打满（多处超 MVP），但 n8n 最难复制的两块——**V3 引擎化 Agent 循环**与 **usableAsTool 存量节点即工具**——恰是短板。

| 对标点 | 状态 | 证据 | 说明/缺口 |
|---|---|---|---|
| supplyData 协议 | ✅有意偏离(合理) | `node-execution-context.ts:30-76`（懒解析+MAX_DEPTH=8）；`interfaces.ts:339` IAiLanguageModel/Tool/Memory ‖ §1 | 自研类型化能力对象，不搬 LangChain，协议干净 |
| **Agent 循环引擎化（V3）** | ⚠️**偏离(踩坑·最关键)** | `AiAgent.node.ts:86-98` 节点内 `while` 内联循环，`tool.invoke()` 直调——工具**非**真节点入引擎 ‖ §2「V3=EngineRequest 交还主循环」 | 停在 n8n **V2**；工具调用不白嫖引擎重试/取消/HITL/观测 |
| 双循环割裂 | ⚠️偏离(踩坑) | 画布内联循环 + `instance-ai-service.ts:146` 另一套 bespoke 编排 ‖ §8 | 加 cancel/stream 要做两遍；HITL 只在助手侧、画布 agent 没有 |
| logWrapper / per-子节点观测 | ❌未计划 | AiAgent 直调 model/tool/memory，无 addInputData/addOutputData ‖ §1 | 执行详情看不到每次模型/工具单独调用，多工具 agent 调试难 |
| 连接端口类型建模 | 🟡 | `interfaces.ts:93-98` 仅 3 种 AI 端口；grep vectorStore/embedding/retriever/chain 空 ‖ §8 | 机制正确但 3/12 端口；缺整条 RAG 链 |
| 结构化输出/outputParser | ❌未计划 | 无 ai_outputParser 端口、无 format_final_json 合成工具 ‖ §2 | Agent 无法产结构化 JSON |
| **usableAsTool 自动派生** | 🟡抢跑机会 | 原语已就位（`from-ai.ts`+`HttpTool.node.ts:89`），无 convertNodeToAiTool 工厂 ‖ §3/§8 | $fromAI 齿轮已造，差一个"克隆节点描述→输出改 ai_tool"工厂 |
| 流式回复 | ❌未计划 | 全阻塞单发（`assistant-service.ts:273`/`agent-run-service.ts:165`）；push-hub 只推 execution 事件 ‖ §6 | 四聊天面全无 token 流式 |
| 四聊天面 | ✅对齐(抢跑) | ChatTrigger/Chat 页/Agents/实例助手/Builder（5 面）‖ §6 | 面数齐甚至多；缺可嵌入公开 chat 组件 |
| MCP server / client 三向 | ✅/🟡 | server `mcp-service.ts:280` JSON-RPC+PKCE；client `instance-ai-mcp.ts:38` HTTP 最小子集 ‖ §4 | server 只暴露已发布 workflow；client 只接实例助手，**画布 AiAgent 消费不了外部 MCP** |
| 记忆窗口+分层 embedding | ✅ | `WindowMemory.node.ts:30` + `agent-run-service.ts:151` 分层+证据链 ‖ §6 | 设计对齐 n8n |
| embedding 质量 | 🟡踩坑 | `embedding.ts:6-21` 本地 64 维 FNV 哈希词袋非语义向量 ‖ §3 | 改述/近义召回失效 |
| token/成本核算 | ✅ | `ChatModel.node.ts:278` 解析 provider usage → `agent-run-service.ts:37` computeCost ‖ §5 | 真 DeepSeek 验证；仅 Agents 模块计费，画布/Chat 页不计 |
| HITL + checkpoint/restore + 运行树 | ✅抢跑 | `instance-ai-service.ts:169`(propose/approve/reject) + `:99`(checkpoint) + `:146`(运行树)‖ §2/§6 | 自建深代理，对齐 n8n 最强面；但只在实例助手，画布 agent 无 |

**该域最该动的 3 条**
1. **[踩坑·战略] Agent 循环引擎化（V2→V3）** — 现内联 while+`tool.invoke` 直调，工具非真节点；画布 agent 与 instance-ai 两套循环割裂。n8n 全篇最核心情报（"跳过 V2 直接 V3"）。不动它，重试/取消/HITL/流式/per-工具观测都得两处各造，画布 agent 永远拿不到 HITL。→ 工具调用打包成引擎请求、由 workflow-execute 主循环调度工具节点、Agent 以 resume 恢复，统一一套引擎化循环。→ 建议新增（XL，AI 运行时地基重构）。
2. **[抢跑·低垂果] usableAsTool 工厂 + 真 embedding 端口** — $fromAI 原语已建好，差一个 `convertNodeToAiTool`（克隆节点描述→输出改 ai_tool），即可让存量 20+ 节点全变 AI 工具（最大杠杆/最难复制）；同时 `embedding.ts` 哈希词袋换 provider embedding 端口。两者投入小杠杆大。→ 建议新增。
3. **[缺能力] 四聊天面流式回复** — 全阻塞单发，缺"打字机"体验。→ ChatModel.chat 加 stream 通道；匿名 ChatTrigger 用 chunked、登录内用 WS Push、助手/agent 用 SSE（按面选型）。→ 建议新增（M/L）。

**待确认**：MCP server 队列模式会话路由（只见 InMemory Map）；ChatTrigger 是否有可嵌入公开聊天组件（似缺"对外嵌入"）；AiAgent 是否支持第二 model 作 fallback（初判缺失）；画布 AiAgent 运行中能否取消（循环在节点内 while，疑不可中途取消）。

---

### 100 · 画布交互层（`packages/frontend`）

交互复刻广度高，但**执行可视化的实时正确性**与协同地基是短板。

| 对标点 | 状态 | 证据 | 说明/缺口 |
|---|---|---|---|
| Vue Flow 受控模式 | ⚠️偏离(踩坑风险) | store 契约为真源（`stores/editor.ts:19`）但 `WorkflowCanvas.vue:274 apply-default=true` ‖ §1 | 非严格受控；VueFlow 同时改内部态靠事件回镜→双写漂移风险 |
| 单一变更入口（apply 收敛） | ❌缺失 | editor.ts 各 action 直写 `this.nodes` ‖ §3 | CRDT 需要的"唯一写入点"纪律未建立，日后接协同要重写状态层 |
| 拖拽/多选/框选/缩放/端口加节点/连线中点插入/便签/右键菜单 | ✅ | `WorkflowCanvas.vue` + `CanvasNode.vue` + `CanvasEdge.vue` | 交互主体已复刻 |
| 连线校验 | 🟡 | `WorkflowCanvas.vue:76` 仅校验 type 相等 ‖ §4 | 缺端口存在性/便签禁连/maxConnections/成环策略 |
| 撤销重做 | 🟡 | `editor.ts:131` 全量 JSON 快照栈（深50）‖ §4 | 粗粒度、CRDT 不友好；未从 undo 推导脏节点 |
| Minimap | ❌未计划 | grep 零命中 ‖ §1 | 未引入 |
| **删除节点自动桥接上下游** | ❌缺失 | `editor.ts:223` removeNode 只删+剥连线，无 connectAdjacentNodes ‖ §4 | 删中间节点后断链需手工重连 |
| 快捷键全集 | 🟡 | ~10 键 vs 基线~40；右键菜单标注的 D/P/Space/R 仅文案未全局绑定 ‖ §4 | 缺分组/抽取/图导航等 |
| **Push nodeExecuteAfter 逐节点补全量** | 🟡 | `execution-service.ts:768` 仅 itemCount，全量走 `executionFinished` 后 REST refetch ‖ §5 | "计数先行"精神在，但无逐节点渐进，大流量无进度 |
| 边执行 item 数标签 | ❌缺失 | itemCount 在 store 未画到边 ‖ §5 | |
| **WS 健壮性（心跳/重连）** | ⚠️踩坑 | `execution.ts:38` onclose 仅置 null；`ws/attach.ts` 无 ping/pong | 断线即静默丢实时进度直到刷新 |
| **执行事件串台过滤** | ⚠️踩坑 | `execution.ts:44` handleEvent 不按 executionId 过滤；`push-hub.ts:27` 广播全连接无频道 ‖ §5 | 并发执行/多用户下高亮串到别的画布 |
| Presence（谁在编辑） | ❌未计划 | 仅 upsell 文案，无在线头像/光标 ‖ §3 | 完全空白 |
| **单写者锁/版本冲突** | ❌未计划 | `editor.ts:94` save() 末位写覆盖，无心跳锁/409 ‖ §3 | n8n 当前线上协作即此层，nomops 全无→并发编辑静默互相覆盖 |
| CRDT 协同预留 | ❌缺失(双方空白·抢跑) | 无 CRDT/Yjs ‖ §3 | 窗口在，但 nomops 状态层非 apply 收敛→地基比 n8n 更薄 |

**该域最该动的 3 条**
1. **[踩坑] 执行可视化正确性三连（串台+无重连+广播无频道）** — `execution.ts:44` 不按 executionId 过滤 + `push-hub.ts:27` 广播全连接无 workflow 频道 + `execution.ts:38` 断线不重连；三者叠加：只要第二个执行/第二个用户/一次断网，画布高亮就错乱或静默停更。→ client `handleEvent` 首行 `if (event.executionId !== currentExecutionId) return`；push-hub 按 workflowId 分频道；WS 加指数退避重连+心跳。低成本、直接修复可信度。→ 建议新增。
2. **[缺能力] 删除节点自动桥接 connectAdjacentNodes** — `editor.ts:223` 删中间节点后断链；是 n8n 最基础可用性细节。→ removeNode 时若被删节点单入单出 main，自动接上游→下游。→ 建议新增。
3. **[抢跑] 协同编辑窗口——但须先打地基** — 无 presence/写锁/CRDT；窗口在（n8n 也仅"已建未接"），但 nomops 现状更靠后（状态层未 apply 收敛、undo 快照式）。→ 两步：先补"保存乐观锁"（workflow 加 version 列，save 带版本，后端 409 冲突提示而非覆盖，立即消除并发丢改）；同时把 editor store 重构为"public 方法→私有 applyXxx 唯一写入点"为 CRDT/undo 命令化铺路。→ 建议新增（独立 EPIC）。

**待确认**：触控/pinch 手势依赖 @vue-flow 默认，移动端完备度待活体；`apply-default=true` 是否需切 `apply-changes=false`（批量操作漂移待压测）。

---

### 110 · Webhook 子系统（`packages/server` · `packages/nodes`）

等待恢复状态机"别过度设计"落地良好；但恢复 URL 的 GET 预览误触是高危踩坑，Webhook 节点能力面过薄。

| 对标点 | 状态 | 证据 | 说明/缺口 |
|---|---|---|---|
| 路由表进 DB + 复合主键 + 静态多段匹配 + 冲突检测 | ✅ | `sqlite.ts:884`；`controllers/index.ts:2879`；`active-workflow-manager.ts:93` ‖ §1 | 与基线同构 |
| 动态 `:param` 路径段 | ❌未计划 | path 仅字面量 `Webhook.description.ts:14`；无 webhookId/pathLength 列 ‖ §1 | `users/:id` 当字面量，捕获不了 `/webhook/users/123` |
| 测试/生产双路径（`/webhook-test`） | ❌未计划 | 仅 `/webhook/*`、`/webhook-waiting/*` ‖ §0/§3 | 编辑器"Listen for test event"未做 |
| 响应模式 onReceived / responseNode | 🟡/✅ | `RespondToWebhook.node.ts:45` 4 子模式；**队列模式不中继**（`controllers/index.ts:2901` 注释）‖ §2 | 六模式覆盖 2/6；缺 lastNode/streaming/formPage/hostedChat |
| 等待恢复三字段+轮询器（leader-only 语义） | ✅ | `wait-tracker.ts:9-45`；`repositories.ts:1298` 正确排除 onSignal ‖ §5「别过度设计」 | 简单正确 |
| Wait 节点模式 | 🟡 | `Wait.description.ts:19` 仅 afterDelay+onSignal，单位 s/m/h ‖ §5 | 缺"指定时刻"、缺表单提交模式、天/周单位 |
| Resume URL Layer1 不可猜+常数时间 | ✅ | `execution-service.ts:98` randomBytes(24)；`controllers/index.ts:2947` timingSafeEqual+404 ‖ §5 | 到位（token 在 path 段更好） |
| Resume URL Layer3a 结构性防重放 | ✅ | 首次 resume 翻转 status→二次 404 `controllers/index.ts:2943` ‖ §5 | 一次性到位 |
| **Resume URL Layer3b GET 预览防误触** | ⚠️**偏离(踩坑·高危)** | `router.all('/webhook-waiting/...')` 对 GET/HEAD 立即 resume `controllers/index.ts:2933`；无 isbot/UA 过滤 ‖ §5 Layer3 | #15 场景就是把 resumeUrl 发进邮件/IM，链接预览/SafeLinks 扫描 GET 即自动"批准"+耗尽令牌→人再点得 404 |
| Resume URL Layer2 HMAC 签 approve/reject | ❌未计划 | 无 HMAC；webhook-waiting 无条件 resume ‖ §5 Layer2 | 真 HITL approve/reject 落地前缺 |
| Form 触发 | ❌(backlog #52) | 全仓无 Form 节点 ‖ §7 | 已规划，去 n8n 字样 |
| 轮询去重（staticData 游标） | ✅ | `active-workflow-manager.ts:292` filterNewKeys ‖ §8 | 已具备 |
| Webhook 节点认证/CORS/ignoreBots/onlyRunIf | ❌未计划 | `Webhook.description.ts` 仅 path+method ‖ §9 | 生产 webhook 仅靠 path 保密，无鉴权/防 bot/条件闸门 |

**该域最该动的 3 条**
1. **[踩坑·高危] `/webhook-waiting` GET 预览误触发 + 无 bot 过滤** — `controllers/index.ts:2933-2953`（`router.all` + 无条件 resume，零 UA/method 判别）；#15 初衷正是把 resumeUrl 发进会自动 GET 预取的渠道（Slack/Teams unfurl、Outlook SafeLinks、iMessage），预览 bot 一次 GET 会在无人确认下"批准"挂起流并耗尽令牌。→ webhook-waiting 只对 POST 执行副作用；GET 返回仅渲染"确认恢复"按钮的空 200 页；HEAD/已知 bot UA 直接空 200 短路。→ 建议新增（#15 安全加固）。
2. **[缺能力] Webhook 节点能力面过薄：无鉴权/无 responseMode 深度/无动态 `:param`** — 生产 webhook 仅靠路径保密即可被任意触发；响应模式 2/6；动态路径段不支持。→ 优先补 Webhook 鉴权四档（none/basic/header/jwt，生产安全刚需）+ responseMode=lastNode；动态 `:param` 与 streaming 可延后。→ 建议新增（归 P4 触发器深化）。
3. **[抢跑] HITL 恢复缺 Layer2 签名** — 当前是"无决策 resume"，没为"携带可信决策"预留位。→ 在 #52 或独立 HITL 立项时，给 webhook-waiting 增 HMAC-SHA256 签 `path+query`（含 `decision=approve|reject`）的第二类链接，与随机 token 并存。→ 建议新增（绑 #52）。

**待确认**：队列模式下 RespondToWebhook 自定义响应中继是否已在 BullMQ 路径补过（inline 路径注释明示未实现）；Webhook 处理器注册在 `express.json(15mb)` **之后**（`app.ts:30/38`），未来做原始体/文件上传 webhook 会受限。

---

### 120 · 模板生态与新手漏斗（`packages/frontend` · `packages/server`）

产品内模板浏览+导入齐全；增长侧机制**正确地划归独立仓 nomops-cloud**，不应在本仓补。本仓真缺口是"导入后能跑"的凭证向导与激活链。

| 对标点 | 状态 | 证据 | 说明/归属 |
|---|---|---|---|
| 模板浏览 UI（画廊+搜索+分类） | ✅ | `TemplatesView.vue:44-113` ‖ §1/§3 | 齐全 |
| 一键导入建流 | ✅ | `TemplatesView.vue:30`；`controllers/index.ts:2435`；`templates.test.ts` ‖ §2 | 导入=真建 workflow 且实测可跑 |
| 模板来源 | ⚠️有意偏离(合理) | `template-registry.ts:24` 4 个 BUILTIN 硬编码 ‖ §1 | 基线走 api.n8n.io+营销站分流；nomops 本地内置，自托管定位下合理 |
| **导入漏斗-凭证设置向导 `/templates/:id/setup`** | ❌缺失 | `router.ts:29` 无 setup 路由；import 直建流无分支 ‖ §2（核心洞察） | **note 明说的第一优先级**；无"需凭证→向导/不需→落画布"分支。本仓产品缺口 |
| 预注入样例凭证 / Ready-to-Run | ❌缺失 | 全仓无 sample credential；`template-registry.ts:19` 仅静态 setupHints 文字 ‖ §4（激活杀招） | 「激活杀招」缺位。本仓可落 |
| 空状态推荐模板 | ❌缺失 | `OverviewView.vue:1013` 空态仅 "Start from scratch" ‖ §3 | 空状态露 starter 属本仓 |
| 首装 setup 流（owner 引导） | ✅ | `LoginView.vue:16`；`needs-setup.test.ts` ‖ §4 | needsSetup 门→owner 建号→第二人 403，闭环完整 |
| 教育面 Help 菜单 + What's New 红点 | ✅ | `SideBar.vue:306`；`:68` 未读红点 ‖ §5 | 触达面已建；外链无 UTM（自有站未上线） |
| 病毒归因署名 appendAttribution | ❌缺失(边界) | 全仓无 attribution ‖ §5 | 基线最便宜增长环；本仓可落但自有域名未上线，现阶段搁置合理 |
| UTM 信标 / 营销站分流 / 问卷·PostHog / A-B 实验 / NPS | ❌**属独立仓 nomops-cloud** | grep 全空；营销站在 CP（`docs/10:40`），账户/订阅在 CP（`backlog:165`） | 增长基建归 Cloud 控制平面，本仓不含合理 |

**该域最该动的 3 条**
1. **[缺能力] 凭证设置向导** — 导入漏斗只有 import→canvas，`setupHints` 仅静态文字；是 note §2 明说的模板功能第一优先级（"难点不是展示而是导入后能跑"）。→ 新增 `/templates/:id/setup` 向导：按凭证类型+名称分组卡、无歧义自动填充（跳过通用 HTTP/OAuth）、可跳过。→ 建议新增（纯本仓产品能力）。
2. **[缺能力] 空状态→模板→可跑 的激活链断裂** — 空状态只有 "Start from scratch"，不露模板；无预注入样例凭证的一键可跑。→ 空状态推一张 starter 卡，直接塞 `branch-merge-demo`（免凭证、导入即可手动跑，天然 Ready-to-Run 素材）。→ 建议新增（本仓激活）。
3. **[抢跑警示·勿在本仓补] 增长侧机制多属独立仓** — UTM/营销站/问卷/PostHog/实验/额度/NPS 本仓缺失但按 `docs/10` + `backlog:165` 属 nomops-cloud 范围外，**不应在本仓补**。唯一边界项 `appendAttribution` 待自有域名上线后再评估。

**待确认**：增长侧 4 项是否已在 nomops-cloud 落地（本审查仅覆盖本仓）；`setupHints` 是刻意轻量还是计划升级为向导（决定第1条是缺陷还是有意偏离）；appendAttribution 是否有意等品牌上线。

---

### 130 · 安全模型（横切 `server`/`core`/`db`）

铁律3、logout 黑名单、argon2 落地良好；但**出站 SSRF、表达式沙箱、社区包安装**三处是高危踩坑，账户安全有一组中危缺口。

> 重要口径：表达式数据经 **scope 绑定**传入（非字符串拼接，`evaluator.ts:156`），故沙箱逃逸需**恶意表达式作者**（能编辑工作流的人），非远程未授权数据注入。单租户自托管风险较低；多租户 Cloud（nomops 明确要做）下租户即攻击者=高危。

| 对标点 | 状态 | 证据 | 风险等级 |
|---|---|---|---|
| **SSRF 出站防护（连接期真实 IP 校验）** | ❌缺失 | `node-execution-context.ts:170-183` `fetch(url)` 无 IP 校验、默认跟随重定向；`HttpRequest.node.ts:24` 直传用户 URL ‖ §6/§12.3 | **高危**：用户可控 URL 可打 `169.254.169.254` 云 metadata/`127.0.0.1`/RFC1918；重定向式绕过也成立。零防护、零 opt-in |
| **表达式沙箱隔离（可逃逸）** | ⚠️偏离(踩坑) | `sandbox.ts:6-25` 正则黑名单 + `:58` 进程内 `new Function`（非 isolated-vm）‖ §7 | **高危(Cloud)/低危(单租户)**：`[]['con'+'structor']['con'+'structor']('return th'+'is')()` 绕正则取回真实 global→进程内 RCE |
| **社区包安装（npm 信任边界）** | 🟡踩坑 | `community-node-service.ts:49` `npm install` **无 `--ignore-scripts`**；`:130` 动态 import 进程内注册 ‖ §9/§12.4 | **高危**：恶意/抢注包 pre/postinstall **安装期即宿主 RCE**；缺 provenance/静态扫描/checksum，仅 admin 门控兜底 |
| JWT 改密/改邮箱踢下线（hash 绑定声明） | ❌缺失 | `auth-service.ts:194` changePassword 只换 hash 不动会话；`:346` payload 无口令 hash 绑定 ‖ §1/§12.1 | **中危**：被盗 JWT 后"改密"不能踢下线，旧 token 存活至 7d TTL。本域头号对标点 |
| JWT 登出即时吊销（#37） | ✅ | `auth-service.ts:339` + `middleware.ts:117` 验签后查黑名单 ‖ §1 | 单 token 吊销可用；无"吊销某用户全部会话" |
| browser-id 绑定 | ⚠️有意偏离(合理) | 全仓无 browserId；`middleware.ts:104` 仅读 Bearer 头 ‖ §1/§5 | 低危：Bearer 头非 cookie→CSRF 面消失，browser-id 非必需 |
| RBAC 三级（全局/项目/资源） | 🟡 | `assertInstanceAdmin`；`middleware.ts:132 requireRole`；shared_* 带 role ‖ §3 | 三层都在，非统一 `resource:action` 解析器 |
| **自定义角色 scope 强制粒度** | 🟡 | `rbac.ts:49-53 tierForScopes` 把 scope 集**塌缩成 viewer/editor/owner 三档** ‖ §3 | **中危**：勾 `credential:delete` 即整体升 editor，放行同档全部动作=越权面 |
| SSRF/凭证明文不外泄（铁律3） | ✅ | `credential-service.ts:57 toView` 剥离 data；无取值端点 ‖ §10 | 解密边界收口正确 |
| 密码 argon2 + 备份码哈希 | ✅ | `auth-service.ts:71` argon2；备份码 sha256 单次消费 ‖ §2 | 强于基线 bcrypt |
| **MFA TOTP 密钥落库** | 🟡 | `mfa-service.ts:104` `mfaSecret` **明文入库**（`schema/sqlite.ts:27`）‖ §2 | **中危**：DB 泄露即可复算有效码（n8n 对 secret AES 加密） |
| **登录/MFA 限流** | ❌缺失 | 全仓无 rate-limit 中间件；login/verifyCode 无尝试计数 ‖ §2 | **中危**：口令与 6 位 TOTP 均可无限猜 |
| 安全响应头 / webhook·form CSP | ❌缺失(待确认) | 无 helmet/CSP/X-Frame-Options ‖ §5/§10 | 低-中危：无 clickjacking/CSP；若 Form 回传作者 HTML 则缺 sandbox |
| 静态安全审计扫描器（`n8n audit`） | ❌未计划 | `audit-service.ts` 仅事件流水，无风险扫描 ‖ §8 | 低危缺能力：无"未用凭证/SQLi 表达式/无认证 webhook"巡检 |
| JWT alg 未固定 | ⚠️踩坑(低) | `auth-service.ts:325` 未传 `algorithms:['HS256']` ‖ §10 | 低危：对称 secret 下无 alg-confusion，仍建议显式钉 |

**该域最该动的 3 条**
1. **[踩坑·高危] SSRF 出站零防护** — 风险高（Cloud metadata 凭证窃取/内网横移）。`node-execution-context.ts:170`（`fetch(url)` 无校验、跟随重定向）。→ `defaultHttpRequest` 加**连接期真实 IP 校验**（自定义 `lookup` 校验解析 IP，拦 RFC1918/loopback/`169.254`/IPv6 ULA，每次重定向重校），按"URL 是否用户可控"opt-in，固定内部目标豁免。→ 建议新增（本域最高优先）。
2. **[踩坑·高危] 表达式沙箱可逃逸→进程内 RCE** — 高危(Cloud)/低危(单租户)。`sandbox.ts:6-25,58`，PoC 绕正则取回真实 global。→ 改 isolated-vm 或复用 Code 节点独立进程模型；至少堵 `.constructor`/bracket 动态取属性。铁律级硬约束。→ 建议新增（与 70 域同源，合并做）。
3. **[踩坑·高危] 社区包 npm install 未 `--ignore-scripts`** — 安装期宿主 RCE。`community-node-service.ts:49`。→ 加 `--ignore-scripts`，补 provenance 预检 + 静态扫描（禁 `eval`/`Function`/`child_process`、import 白名单）+ checksum + 未验证包开关；长期把社区节点执行移出主进程。→ 建议新增。

**次高一档（一并排期）**：改密/重置不吊销存量会话（§1 头号对标点，中危，建议 tokenVersion）；无登录/MFA 限流（中危）；MFA 密钥明文落库（中危）；自定义角色 scope 塌缩成 tier（中危越权面）。

**待确认**：webhook/Form 节点是否输出作者可控 HTML（若是缺 sandbox CSP→同源 XSS）；Code 子进程是否有 OS 级封禁（seccomp/容器/降权，取决于部署层）；审计日志是否覆盖 login.failed/凭证解密访问/角色变更/API-key 签发；MFA 列是否有透明列级加密。

---

## 全局优先级清单（报告核心 · 跨域汇总排序）

> 说明：nomops 覆盖广度极高，绝大多数"n8n 有"的能力已实现或已在 backlog（#1–#54）计划。以下**只收三类真问题**：踩坑、缺能力、抢跑机会。每条注明 差距 / 证据 / 建议动作 / 关联 backlog（无则「建议新增」，编号见文末增补建议）。

### 🔴 必补（缺了会踩坑或阻断核心场景）

| # | 差距 | 类型 | 证据 | 建议动作 | backlog |
|---|---|---|---|---|---|
| R1 | **表达式沙箱可逃逸 + 无超时** — `new Function`+正则黑名单被 `['con'+'structor']` 击穿，PoC 读到真实 `process.env`；死循环挂死 worker | 踩坑·高危(Cloud) | `sandbox.ts:6-25,58` ‖ 70§3/130§7 | 弃正则+Function，改 isolated-vm 或复用 Code 节点子进程 runner + `{timeout}`；堵 bracket 动态取属性 | 建议新增 #55 |
| R2 | **SSRF 出站零防护** — 用户 URL 直打云 metadata/内网，跟随重定向 | 踩坑·高危 | `node-execution-context.ts:170`、`HttpRequest.node.ts:24` ‖ 130§6 | 连接期真实 IP 校验（拦 RFC1918/loopback/169.254/ULA，重定向重校），可控 URL opt-in | 建议新增 #56 |
| R3 | **社区包 npm install 未 `--ignore-scripts`** — 安装期宿主 RCE | 踩坑·高危 | `community-node-service.ts:49` ‖ 130§9 | 加 `--ignore-scripts` + 静态扫描 + checksum + provenance；长期移出主进程 | 建议新增 #57 |
| R4 | **加密密钥入库 + 无信封/轮换** — 密钥与密文同库，DB dump 同泄；换密钥即全量不可解 | 踩坑·高危 | `bootstrap.ts:84-98`、`cipher.ts:7` ‖ 80§5 | `NOMOPS_ENCRYPTION_KEY` env/文件来源（把密钥挪出库）+ 密文 `keyId:` 前缀 DEK 信封 | 建议新增 #58 |
| R5 | **`/webhook-waiting` GET 预览误触发** — 邮件/IM 链接预览 bot 一次 GET 即"批准"HITL 流并耗尽令牌 | 踩坑·高危 | `controllers/index.ts:2933-2953`（`router.all`+无条件 resume）‖ 110§5 | 只对 POST 执行副作用；GET 返"确认恢复"空 200 页；bot UA 短路 | 建议新增 #59（#15 加固） |
| R6 | **动态节点参数层缺失**（loadOptions/resourceLocator/fixedCollection）— 架空整个 P11 节点扩张与 355 app 集成 | 缺能力·阻断核心 | grep 全空 ‖ 20§H/50§7.3/60§4 | 补 `dynamic-node-parameters` 端点（以用户凭证代查）+ 节点 loadOptions/RLC 契约 + `fixedCollection` 控件；引擎侧声明式（符铁律5） | 建议新增 #60（P11 前置） |

### 🟠 应对齐（n8n 证明必要，nomops 缺或偏离）

| # | 差距 | 类型 | 证据 | 建议动作 | backlog |
|---|---|---|---|---|---|
| A1 | **前端节点特判违铁律5** — 面板分类按类型名硬编码致 #5 已交付节点落不进抽屉；filter/assignment 按参数名伪装进 collection | 踩坑 | `NodePanel.vue:43-46`、`ParamInput.vue:243,498` ‖ 50§2/60§1 | 节点描述加 `categories/subcategories`，面板与控件改元数据/type 分发 | 建议新增 #61（#48 前置） |
| A2 | **声明式 routing DSL 只做单请求** — 缺分页/postReceive/preSend，SaaS 节点凡翻页/响应转换都退回 execute() | 缺能力 | `interfaces.ts:159`、`routing-executor.ts` ‖ 00§4-⑦/30§4 | DSL 扩 `pagination` + `postReceive`/`preSend` 钩子 | 建议新增 #62 |
| A3 | **凭证注入 DSL 受限 + UI 悬空能力** — 仅 header/query/path、绑节点非绑凭证、无函数式；digest/OAuth1/PKCE/clientCredentials 声明未兑现 | 缺能力/踩坑 | `routing-executor.ts:97`、`credential-types.ts:108` vs `oauth2-service.ts:90` ‖ 80§2/§4 | 注入模板上移凭证类型；补 body+basic 桶+函数式 authenticate；未实现选项从 UI 摘除 | 建议新增 #63 |
| A4 | **OAuth2 多实例失效 + 无刷新锁** — 进程内 pending Map、queue 多 worker 双刷竞态作废 refresh_token | 踩坑 | `oauth2-service.ts:29,75,130` ‖ 80§4 | pending state 落 Redis/DB（TTL 读即销毁）+ 刷新租约锁 | 建议新增 #64 |
| A5 | **取消/超时不贯通 AbortSignal** — 节点内在飞 HTTP 继续跑，侵蚀并发余量 | 踩坑 | 全域无 AbortController；`workflow-execute.ts:438` 注释自陈 ‖ 30§2 | AbortSignal 经 `additionalData.httpRequest` 贯通 fetch，cancel/超时即 abort | 建议新增 #65 |
| A6 | **执行可视化正确性三连** — 不按 executionId 过滤（串台）+ 广播无 workflow 频道 + WS 断线不重连 | 踩坑 | `execution.ts:44,38`、`push-hub.ts:27` ‖ 100§5 | handleEvent 按 executionId 过滤 + push-hub 分频道 + WS 指数退避重连+心跳 | 建议新增 #66 |
| A7 | **账户安全四缺**：改密/重置不吊销会话；无登录/MFA 限流；MFA 密钥明文落库；自定义角色 scope 塌缩成 tier | 踩坑·中危 | `auth-service.ts:194`、无 rate-limit、`mfa-service.ts:104`、`rbac.ts:49` ‖ 130§1/§2/§3 | tokenVersion 吊销会话；登录/MFA 限流；MFA secret 加密；自定义角色逐 scope 校验 | 建议新增 #67 |
| A8 | **displayOptions 缺 `@version` 门控 + `_cnd`** — 节点版本演进即破坏存量工作流 | 缺能力 | `display-options.ts:8-32`、`NdvModal.vue:180` ‖ 60§2 | `IDisplayOptions` 支持 `{_cnd:{…}}` + `isPropertyVisible` 加 `@version` 门控 | 建议新增 #68 |
| A9 | **Agent 循环未引擎化（停在 V2）** — 工具非真节点、画布/助手两套循环割裂，拿不到引擎重试/取消/HITL/观测 | 踩坑·战略 | `AiAgent.node.ts:86-98` 内联 while ‖ 90§2/§8 | 工具调用打包引擎请求、主循环调度、Agent 以 resume 恢复，统一一套 | 建议新增 #69（XL） |
| A10 | **Luxon + 0 扩展方法** — `$now.plus()`/`.isEmail()`/`.first()` 全报错，DX 断层 | 缺能力 | grep luxon 零命中 ‖ 70§7 | 接 Luxon（$now/$today 改 DateTime）+ 首批扩展方法 + `.doc` 元数据 | 建议新增 #70 |
| A11 | **Webhook 节点能力面过薄** — 无鉴权四档/无 responseMode 深度/无动态 `:param` | 缺能力 | `Webhook.description.ts:14-38` ‖ 110§2/§9 | 补鉴权四档 + responseMode=lastNode；动态路径段延后 | 建议新增 #71 |
| A12 | **发布缺事务发件箱 + waitTill 无索引** — 多实例发布事件最终一致无兜底；WaitTracker 每 10s 全表顺扫 | 踩坑 | 无 publication_outbox（#40 deferred）、`pg.ts:734` 缺索引 ‖ 00§4-⑤/10 | 补 outbox 表+投递 worker；加 `(status,wait_till)` 部分索引 + WaitTracker leader 门控/CAS | 承接 #40 + 建议新增 #72 |
| A13 | **License 无吊销 + 配额 check-increment 竞态** — 退款/泄露只能等过期；queue 多 worker 超发配额 | 缺能力/踩坑 | `license-service.ts:108`、`quota-service.ts:78` ‖ 40§4/08§4 | cert-id 黑名单经 `/internal` 桥；配额原子自增（ON CONFLICT RETURNING / Redis） | 建议新增 #73 |
| A14 | **删除节点不桥接 + 模板无凭证向导** — 删中间节点断链需手工重连；模板导入后无"需凭证→向导" | 缺能力 | `editor.ts:223`；`router.ts:29` 无 setup 路由 ‖ 100§4/120§2 | removeNode 单入单出自动桥接；新增 `/templates/:id/setup` 向导 + 空态 starter 卡 | 建议新增 #74 |

### 🟢 可抢跑（n8n 未做好的差异化窗口）

| # | 机会 | 证据 / 现状 | 建议动作 | backlog |
|---|---|---|---|---|
| G1 | **usableAsTool 自动派生** — 存量节点一键变 AI 工具，竞品最难复制的护城河；nomops ai_tool 端口+$fromAI 原语已就位 | `AiAgent.node.ts:45-49`、`from-ai.ts` ‖ 50§7.4/90§3 | `INodeTypeDescription` 加 `usableAsTool` + loader 层 `convertNodeToAiTool` 工厂克隆为 `*Tool` 变体；8 集成+HttpRequest 一次性全变工具 | 建议新增 #75（低垂高杠杆） |
| G2 | **前端同构表达式预览"预览即真值"** — 引擎已在 workflow 包、天然可跑浏览器，n8n 视其为体验前提 | `ExpressionInput.vue` 未 import 引擎 ‖ 70§9 | 把 `resolveParameterValue` 接进 NDV 实时预览 + 按运行数据补全真实字段/方法 + pending 三态 | 并入 #70 |
| G3 | **CRDT 实时协同** — n8n Yjs 已建未接线；差异化窗口在，但须先打地基 | 无 CRDT；状态层未 apply 收敛、undo 快照式 ‖ 100§3 | 先补保存乐观锁（version 409 防覆盖）+ editor store 改"applyXxx 唯一写入点"，为 CRDT/undo 命令化铺路 | 建议新增 #76（独立 EPIC） |
| G4 | **实例助手 HITL/检查点/运行树/分层记忆 + 动态凭证 + 发布管线** — 三处已**反超**基线（n8n 分别在路上/无/用 active 列） | `instance-ai-service.ts:99,146,169`；`dynamic-credential-service.ts`；publish_history ‖ 90§6/80§9/10 | 巩固并把 HITL/检查点推广到画布 Agent（依赖 A9 引擎化）；对外宣传为差异化卖点 | 已实现（#44/#45/#46/#40），维护+推广 |

### ⚪ 可忽略（有意不做 / 优先级低）

- **Cloud 控制平面 + 增长侧**（UTM 信标/营销站分流/问卷·PostHog/A-B 实验/NPS/免费额度）— 属独立仓 `~/ByteMono/nomops-cloud`，本仓不含（`docs/10`、`backlog:165`）。
- **MySQL/MariaDB、Desktop/Electron** — 已裁决不做（backlog「不做/范围外」+ MEMORY）。
- **内置集成节点广度（缺 ~34 Core + ~101 AI/RAG + ~355 app）** — backlog #48–#54 已计划分期，非缺陷；AI/RAG 待补编号（见待确认）。
- **Data table 物理表（#54）、工作流可视化 diff、OAuth Provider 5 表、执行数据脱敏、Minimap、静态安全审计扫描器** — 低优先/未计划，价值中低。
- **browser-id 绑定** — nomops 用 Bearer 头非 cookie，CSRF 面消失，有意偏离（合理）。
- **安全响应头 helmet/CSP** — 低危且部署层（nginx）可补；若做 Form 节点输出 HTML 时再补 sandbox CSP（并入 A11 时评估）。

---

## 给 feature-backlog 的增补建议（🔴🟠 中尚未在 backlog 的可直接追加项）

> 沿用 backlog 体例（S=半天 · M=1-2天 · L=3天+ · XL=独立立项）。编号接续现有 #54。建议按下列批次组织为新的 P12–P15。

**P12 · 安全加固（最高优先，多为踩坑）**
- [ ] **55. 表达式引擎真隔离 + 超时** `L`（🔴R1）— 弃 `new Function`+正则黑名单，改 isolated-vm 或复用 Code 节点子进程 runner；加求值超时与内存限制；补拼接/计算属性/死循环逃逸测试。验收：`[]['con'+'structor']…` PoC 被拦、`{{ while(true){} }}` 超时不挂 worker。
- [ ] **56. HTTP 出站 SSRF 防护** `M`（🔴R2）— `defaultHttpRequest` 连接期真实 IP 校验（拦 RFC1918/loopback/169.254/IPv6 ULA），每次重定向重校，按"URL 用户可控"opt-in，固定内部目标豁免。验收：节点请求 `http://169.254.169.254` 被拒；重定向到内网被拒。
- [ ] **57. 社区节点安装加固** `M`（🔴R3）— `npm install --ignore-scripts` + 包名/版本/checksum 预检 + 静态扫描（禁 eval/Function/child_process、import 白名单）+ 未验证包开关。验收：含 postinstall 的恶意包安装不执行脚本。
- [ ] **58. 加密密钥外置 + 信封轮换** `M`（🔴R4）— `NOMOPS_ENCRYPTION_KEY` env/文件来源（与库内不一致报错），密文加 `keyId:` 前缀 + DEK 信封。验收：密钥不在 DB；轮换后旧密文仍可解。
- [ ] **59. 恢复 URL GET 预览防误触** `S/M`（🔴R5，#15 加固）— webhook-waiting 只对 POST 执行副作用；GET 返"确认恢复"空 200 页；bot UA 短路。可与 #71 合并交付。验收：预览 bot GET 不触发 resume、不耗令牌。
- [ ] **67. 账户安全四项** `M`（🟠A7）— 改密/重置经 tokenVersion 吊销存量会话；登录/MFA IP+账号双层限流；MFA secret 加密落库；自定义角色改逐 scope 校验（去 tier 塌缩）。验收：改密后旧 token 401；暴破被限流；DB 里 mfa_secret 密文；勾单 scope 不越权到同档其他动作。

**P13 · 节点平台地基（解锁 P11 与集成规模化）**
- [ ] **60. 动态节点参数层** `L`（🔴R6，P11 前置）— `dynamic-node-parameters` 端点（以用户凭证代查远端选项）+ 节点 `loadOptions`/`resourceLocator` 契约 + `fixedCollection` 控件；引擎侧声明式。验收：一个节点下拉能按已选凭证动态拉真实资源列表。
- [ ] **61. 节点面板/控件元数据驱动** `M`（🟠A1，#48 前置）— 节点描述加 `categories/subcategories`，面板分类与 filter/assignment 控件改 type/元数据分发，清掉前端类型名特判。验收：新增节点仅写 description 即自动上架正确分类抽屉。
- [ ] **62. 声明式 routing DSL 增强** `M/L`（🟠A2）— DSL 扩 `pagination` 描述符 + `postReceive`/`preSend` 变换钩子 + 二进制。验收：一个声明式节点能翻页聚合、能变换响应。
- [ ] **63. 凭证注入 DSL 完善** `M`（🟠A3）— 注入模板上移凭证类型（一次声明处处复用）+ body/basic 桶 + 可选函数式 authenticate；未实现的 PKCE/clientCredentials/digest/oauth1 选项要么实现要么从 UI 摘除。验收：digest 或 clientCredentials 凭证可真实工作，或 UI 不再暴露不可用选项。
- [ ] **75. usableAsTool 自动派生工厂** `M`（🟢G1）— `INodeTypeDescription` 加 `usableAsTool`，loader 层 `convertNodeToAiTool` 克隆节点描述为输出 ai_tool 的 `*Tool` 变体。验收：置位的存量节点在 AiAgent Tool 端口可挂载并被调用。

**P14 · 引擎/运行时健壮性**
- [ ] **64. OAuth2 多实例 + 刷新锁** `M`（🟠A4）— pending state 落 Redis/DB（TTL 读即销毁）+ 刷新进程内合并 + Redis/DB 租约锁。验收：queue 模式下 Connect 与刷新不因进程亲和性失败、不双刷作废。
- [ ] **65. AbortSignal 贯通取消/超时** `M`（🟠A5）— AbortSignal 经 `additionalData.httpRequest` 贯通 fetch，cancel()/超时即 abort 网络 I/O。验收：取消卡在慢 HTTP 的执行时底层请求被中断。
- [ ] **69. Agent 循环引擎化（V2→V3）** `XL`（🟠A9）— 工具调用打包引擎请求、workflow-execute 调度工具节点、Agent 以 resume 恢复，画布/助手统一一套循环。验收：画布 AiAgent 工具调用可被取消/挂 HITL/在执行详情逐调用观测。
- [ ] **72. 发布 outbox + waitTill 索引 + WaitTracker 门控** `M`（🟠A12）— 补 publication_outbox 失败重放；加 `(status,wait_till)` 部分索引；WaitTracker 加 leader 门控或 DB compare-and-set 防双唤醒。验收：多实例发布不丢激活；大执行表唤醒不全表顺扫；同一 waiting 不被双恢复。
- [ ] **73. License 吊销 + 配额原子化** `M`（🟠A13）— cert-id 黑名单经 `/internal` 桥下发、`activeCert()` 增查；执行配额原子自增。验收：吊销的证书立即失效；queue 多 worker 不超发配额。

**P15 · 前端/表达式/激活体验**
- [ ] **66. 执行可视化正确性** `M`（🟠A6）— handleEvent 按 executionId 过滤 + push-hub 按 workflowId 分频道 + WS 指数退避重连+心跳。验收：并发执行/多用户/断网下画布高亮不串台、断线自恢复。
- [ ] **68. displayOptions 版本门控 + 操作符** `M`（🟠A8）— `IDisplayOptions` 支持 `{_cnd:{gte/regex/exists…}}` + `isPropertyVisible` 加 `@version` 门控 + 受控值为表达式默认显示。验收：节点升版本参数按 typeVersion 正确显隐，存量工作流不破。
- [ ] **70. Luxon + 扩展方法 + 同构预览** `L`（🟠A10/🟢G2）— 接 Luxon（$now/$today 改 DateTime）+ 首批高频扩展方法（AST 改写路由到 extend）+ `.doc` 元数据；把 `resolveParameterValue` 接进 NDV 做实时预览。验收：`$now.plus({days:1})`/`.isEmail()` 可用；NDV 表达式实时出真值预览。
- [ ] **71. Webhook 节点安全深化** `M`（🟠A11）— Webhook 鉴权四档（none/basic/header/jwt）+ responseMode=lastNode + ignoreBots；`/webhook-waiting` 只对 POST 执行副作用、GET 返确认页（含 #59 恢复 URL 加固）。验收：无鉴权 webhook 可加 header/basic 保护；预览 bot GET 不触发 resume。
- [ ] **74. 删除桥接 + 模板凭证向导 + 空态 starter** `M`（🟠A14）— removeNode 单入单出自动接上下游；新增 `/templates/:id/setup` 凭证向导（分组卡+无歧义自动填充+可跳过）；空状态推 `branch-merge-demo` starter 卡。验收：删中间节点自动重连；模板导入需凭证时进向导；空态一键可跑 starter。
- [ ] **76. 协同编辑地基（EPIC）** `XL`（🟢G3）— 先补保存乐观锁（workflow 加 version 列、save 带版本、409 冲突提示不覆盖）+ editor store 改"public→私有 applyXxx 唯一写入点"，为 CRDT/undo 命令化铺路。验收：并发编辑不静默互覆盖；状态写入收敛到单入口。

> 另需在 backlog 明确登记的**决策点/待确认**（非新功能）：AI/RAG 101 节点是否立独立 EPIC 编号（多模型 Chat Model 最高优先）；Code 节点 Python 是否排期；多人协作 presence 是否做；activeWorkflows 是否作为计费维度；appendAttribution 署名待自有域名上线再评估；helmet/CSP 安全响应头补法（部署层 vs 应用层）。

---

*本报告由 14 域并行只读审查汇总，全程未修改 nomops 任何代码/规范。证据锚点均可回源码复核；标「待确认」项为证据不足、未下定论者。*
