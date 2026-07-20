# 06 — Phase 6a：企业功能包（RBAC + 审计日志 + License 落地）

> Phase 6+ 的第一个落地切片。目标：把 Day-1 埋下的归属边界（project/角色）升级为真正的
> 权限体系，关键操作全程留痕，并让 License 骨架真正控制功能开关。
> 全部工作在现有单体内完成，不涉及多租户控制平面（那是 Phase 6b+）。

---

## 一、范围与边界

**做**
- RBAC：基于 `project_relations.role` 的三级项目角色 + 权限矩阵 + API 强制
- 团队项目：创建 team project、成员增删改、项目切换（企业功能）
- 审计日志：关键操作留痕 + 查询 API（企业功能）
- License 落地：功能开关矩阵，社区版/企业版行为分叉

**不做（后续切片）**
- SSO/SCIM（需要 IdP 集成决策）
- 多租户控制平面、计费
- 实例级用户管理 UI（instance admin 概念保留但只做最小 API 面）

---

## 二、权限模型（硬契约）

### 项目角色（`project_relations.role`，docs/02 已有字段，本文定义语义）

| 权限 | project:viewer | project:editor | project:owner |
|---|---|---|---|
| 读 workflow / execution / credential 列表与详情 | ✓ | ✓ | ✓ |
| 建/改/删 workflow | ✗ | ✓ | ✓ |
| 手动运行 / 激活 / 停用 | ✗ | ✓ | ✓ |
| 建/删/测试 credential | ✗ | ✓ | ✓ |
| 成员增删改、改角色 | ✗ | ✗ | ✓ |
| 查审计日志（本项目） | ✗ | ✗ | ✓ |

- 凭证**解密数据**任何角色都不经 API 获取（铁律 3 不变，执行时注入不受影响）。
- 注册时自动创建的 personal project：创建者为 `project:owner`（现状不变）。

### 项目上下文切换
- JWT 仍在登录时签发（绑定默认 project）。
- 请求可带 `X-Project-Id` 头切换上下文；中间件校验该用户在目标 project 的成员关系，
  不是成员 → 403。`req.auth.projectId` 与 `req.auth.role` 由中间件注入。

### License 功能开关

| feature key | 社区版 | 企业版 | 控制的能力 |
|---|---|---|---|
| `rbac` | ✗ | ✓ | 创建 team project、成员管理、项目切换 |
| `auditLogs` | ✗ | ✓ | 审计日志查询 API（写入始终进行，查询需企业版） |

- 社区版一切现状不变（单人 personal project，全权）。
- 未解锁的功能端点返回 403 `{ error, feature }`。
- License 来源：`LICENSE_KEY` 环境变量（骨架已有；真实验签仍是 TODO）。

---

## 三、数据模型增量（对 docs/02 的扩展）

```typescript
// audit_logs —— 只追加，不更新不删除
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  userId: uuid('user_id'),            // 可空：系统动作（cron 触发）无用户
  projectId: uuid('project_id'),      // 可空：登录/注册等无项目上下文
  action: text('action').notNull(),   // 'workflow.create' | 'workflow.run' | 'auth.login' | ...
  resourceType: text('resource_type'),// 'workflow' | 'credential' | 'execution' | 'project' | 'user'
  resourceId: text('resource_id'),
  details: jsonb('details'),          // 元数据（如 workflow 名）。★绝不含凭证数据/密文
  ip: text('ip'),
});
// 索引：(project_id, timestamp)
```

**审计动作清单（首批）**：`auth.register` `auth.login` `workflow.create` `workflow.update`
`workflow.delete` `workflow.run` `workflow.activate` `workflow.deactivate`
`credential.create` `credential.delete` `project.create` `project.member.add`
`project.member.update` `project.member.remove`。

---

## 四、新增/变更 API

```
GET    /api/projects                     我的项目列表（含我的角色）
POST   /api/projects                     创建 team project        [rbac][任意登录用户→成为 owner]
GET    /api/projects/:id/members         成员列表                  [rbac][project:owner]
POST   /api/projects/:id/members         加成员 {email, role}      [rbac][project:owner]
PATCH  /api/projects/:id/members/:userId 改角色 {role}             [rbac][project:owner]
DELETE /api/projects/:id/members/:userId 移除成员                  [rbac][project:owner]
GET    /api/audit-logs?projectId=        审计查询（倒序分页）       [auditLogs][project:owner]
GET    /api/license                      plan + 已解锁 features（已有，补 features）
```
- 既有全部业务端点接入角色检查（矩阵见上）。
- 所有请求支持 `X-Project-Id` 切换上下文。

---

## 五、实现要点

1. **角色检查进中间件，不散落 controller**：`requireRole('project:editor')` 风格；
   角色每请求查 `project_relations`（不进 JWT，避免改权后旧 token 越权）。
2. **审计走 service 注入**，在 service 层记录（不在 controller 拼），失败不阻断业务
   （审计写入错误只告警）。执行触发型动作（webhook/cron）userId 为空。
3. **社区版零回归**：不设 LICENSE_KEY 时全部现有行为与测试不变。
4. viewer 语义 = 只读，包括不能 `POST /credentials/:id/test`（会触发解密）。

---

## 六、验收标准（全部单测，不依赖外部服务）

- [ ] 权限矩阵逐格生效：viewer 改/跑/激活 → 403；editor 可以；owner 可管成员
- [ ] 成员被移除后立刻失去该项目访问（下一个请求即 403/404）
- [ ] `X-Project-Id` 切到非成员项目 → 403；切到成员项目 → 数据正确隔离
- [ ] 社区版：team project / 成员管理 / 审计查询 → 403 且带 feature 标识；
      设 LICENSE_KEY 后解锁
- [ ] 审计：上述动作清单全部留痕（who/what/when/project）；凭证相关日志不含明文与密文
- [ ] 既有 108 测全部保持绿（社区版零回归）

---

## 七、B1 — License 真实化（已落地）

原骨架是「key 非空即企业版」，等于没有 license。B1 换成**离线验签的证书**。

### 证书格式

```
NOMOPS1.<base64url(payload)>.<base64url(ed25519 签名)>
```

签名覆盖 **payload 的原始字节**，不是重新序列化的结果——键序/空白/数字表示
的任何差异都会让重签的字节对不上，这是 JSON 签名的经典陷阱。

payload：

```jsonc
{
  "id": "…",                 // 证书 id（审计/吊销）
  "plan": "Business",        // 套餐显示名
  "features": ["rbac", …],   // 解锁的功能位
  "quotas": { "teamProjects": 6, "users": -1 },  // -1 = 不限
  "issuedTo": "Acme Inc",    // 可选，仅展示
  "validFrom": "…", "validTo": "…"               // ISO
}
```

### 密钥

- 公钥**编译进产物**（`license-cert.ts` 的 `LICENSE_PUBLIC_KEY`），
  ★**刻意不提供环境变量覆盖**——若公钥可由配置替换，任何人都能自签一张
  Enterprise 证书再把公钥指向自己，验签就形同虚设。钉死在产物里，绕过至少
  需要改源码 + 重新构建。
- **私钥与签发脚本都不在本仓库**（见 `docs/LICENSE-ISSUING.md`）。留在仓库里
  会明示证书格式、降低伪造门槛。
- `LicenseService` 构造函数的 `publicKeyBase64` 参数仅供测试注入自签密钥对；
  生产路径（bootstrap）不传。它是构造参数而非配置项，改它必须改源码。

### 状态机

| status | 含义 | plan | 功能位 |
|---|---|---|---|
| `inactive` | 没填 key | community | 全锁 |
| `invalid` | 填了但验签不过 | community | 全锁 |
| `notYetValid` | 未到生效时刻 | community | 全锁 |
| `expired` | 已过期 | community | 全锁 |
| `active` | 验签通过且在有效期内 | 证书里的 plan | 证书里列出的 |

**有效期按每次查询的时刻计算**，长跑实例无需重启即自然降级。
`activated` 与 `status` 分开回报：填了 key 但失效（`activated=true, status=expired`）
与从未填过（`activated=false`）在 UI 上必须可区分，否则用户不知道该续费。

### 降级原则

★**锁功能，不锁数据**。过期后端点返回 403、配额回落为不限，但已有的团队项目、
变量、审计记录一律保留。续费即恢复，不因晚付几天丢东西。

### 只登记有强制点的开关

`LICENSE_FEATURES` 与 `LICENSE_QUOTAS` **只列当前真有守门代码的项**。
声明了却没人消费的开关等于骗用户「配了就生效」——B0 刚清理过一批这种债。
后续切片（SAML/S3/…）实现时，连同它的强制点一起加进来。

当前配额强制点：

| 配额 | 守门位置 | 计数口径 |
|---|---|---|
| `teamProjects` | `POST /api/projects` | 仅 team 类型；personal 不占额度 |
| `users` | `POST /api/instance/users/invite` | 已激活用户 + 待接受邀请（否则反复邀请可绕过） |

超限返回 **402**（付费即可解除，与 429 限流区分），body 带
`context: { quota, limit, used }`。

### 验收（已全绿）

- [x] 无 key = 社区版，既有行为零回归
- [x] 别人私钥签的证书 → 拒
- [x] 改 payload 留原签名 → 拒
- [x] 签名对但字段非法（validTo ≤ validFrom）→ 拒
- [x] 过期自动降级，`activated` 仍为 true 以区分「没填」
- [x] 有效期按调用时刻算（无需重启）
- [x] 证书未给的功能位不解锁（不是「有证书就全开」）
- [x] 两个配额端到端拦截并返回 402 + 配额详情
- [x] 过期后配额回落为不限（降级不该把人锁得更死）

---

## 八、B7 — 执行并发闸门（已落地）

regular 模式此前**没有任何并发上限**。webhook 洪峰会让单个 Node 进程同时跑起
成百上千个执行，每个都在内存里攥着自己的 runData，最终 OOM 把实例打挂——
连已经排队等着的执行也一起死。

### 语义

**两级响应**：超出并发上限的**排队等待**（对调用方透明，慢一点但不丢）；
连队列也满了才**拒绝**（503 + `Retry-After`）。

★为什么队列必须有上界：无界排队看着温和，实则仍是 OOM 路径——每个排队者
仍攥着一条打开的 HTTP 连接、一份解析好的 Workflow 和一份执行状态。而且
webhook 调用方（GitHub/Stripe 之类）通常 10 秒超时，排队 60 秒的结果是它
超时后**重试**，反而放大洪峰。所以浅队列吸收抖动，深洪峰快速拒绝，把退避
交给调用方本就有的重试逻辑。

| 维度 | 取值 |
|---|---|
| 环境变量 | `NOMOPS_CONCURRENCY_PRODUCTION_LIMIT` |
| 缺省 | 100（regular 模式） |
| 关闭 | `-1` = 不限；`0` 与小于 -1 的怪值同样按不限处理，不把实例卡死 |
| 队列深度 | `NOMOPS_CONCURRENCY_QUEUE_DEPTH`，缺省 = 2× 并发上限；超出即 503 |
| queue 模式 | 闸门不生效——并发由 worker 的 BullMQ 并发度管，两层会互相打架 |

### 受管模式

受管 = 外部可触发的：`webhook` / `trigger` / `chat` / `mcp`。

★**`error` 与 `retry` 刻意不受管**：

- `error` —— 错误处理流必须随时能跑。若它也排队，当所有槽位都被**正在失败的
  执行**占满时，处理这些失败的错误流永远等不到槽位，直接死锁。
- `retry` —— 用户手动发起，不该被生产流量堵住。

手动运行走的是另一条入口（`runManually`），本就不经闸门。

### 实现要点

槽位在 `release` 时**直接交棒**给等待队首，`active` 计数不变。若先减后加会出现
一个瞬时空档，让第三方在此刻抢走本该属于队首的槽位。等待队列是 FIFO，防饿死。

★**闸门必须在建执行记录之前**。队列满时 `acquire` 抛 503，若记录已经建好，
就会留下一条永远不会跑的 `new` 状态记录——而 `new` 是非终态，执行历史清理器
不会碰它，洪峰下即成永久垃圾。被拒的请求也不该吃配额：它压根没执行。

### 可观测

`/metrics` 新增两个 gauge：

- `nomops_executions_active` —— 当前占用槽位
- `nomops_executions_waiting` —— 当前排队数。**持续 > 0 说明该调高上限或上
  queue 模式了**

### 一处行为变更

缺省值是 100 而非不限——也就是说升级后实例默认就带熔断。选这个数是因为单进程
同时跑 100 个执行已远超合理负载，正常流量碰不到；它拦的是病态情形。
要恢复旧行为设 `NOMOPS_CONCURRENCY_PRODUCTION_LIMIT=-1`。

### 验收（已全绿）

- [x] 任意时刻并发不超过上限（30 并发打 3 槽位，峰值恰为 3）
- [x] 超限排队不拒绝，一个执行都不丢
- [x] FIFO，后来的不插队
- [x] `error` / `retry` 不受管，槽位满时立刻放行
- [x] 洪峰过后槽位全部归还，无泄漏
- [x] `-1` 时不计数不排队，行为与 B7 之前一致
- [x] 队列满时返回 503 + `Retry-After`，且**不留下 `new` 状态的垃圾记录**
- [x] 腾出槽位后恢复接受（拒绝是暂时的）
- [x] 端到端：真实 webhook 路径上闸门确实生效

### 测试上的一个教训

端到端用例最初用 Code 节点写 `await new Promise(r => setTimeout(r, 120))` 造「慢
工作流」。但 Code 节点是**纯同步**的（`vm.runInContext` 包在同步 IIFE 里，沙箱
连 `setTimeout` 都没有），那段代码是语法错误，执行**秒失败**——而 webhook 照样
返回 200，于是测试一直是绿的，实际测的是「闸门套在瞬间失败的执行上」。

现在改用一个真会延迟的本地 HTTP 服务（异步、不堵事件循环），并补了一条断言：
**执行本身必须 success**。少了那条断言，同样的假绿还会再来一次。

---

## 九、B3 — S3 兼容二进制存储（部分落地）

### 已做

`S3BinaryStore` 实现 `IBinaryDataStore`，覆盖 AWS S3、MinIO、Cloudflare R2、
Wasabi 等任何讲 S3 协议的后端——所以不单独做 MinIO 实现。

| 环境变量 | 说明 |
|---|---|
| `NOMOPS_S3_BUCKET` | 配了就启用 S3；不配走文件系统 |
| `NOMOPS_S3_REGION` / `_ENDPOINT` | AWS 用 region，自建服务用 endpoint |
| `NOMOPS_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **留空更好**：走 SDK 默认凭证链（IAM role 比长期密钥安全） |
| `NOMOPS_S3_FORCE_PATH_STYLE` | MinIO 通常需要 `true` |
| `NOMOPS_S3_PREFIX` | 对象键前缀，与桶内其他数据分区 |
| `NOMOPS_S3_PRESIGN_EXPIRY_SECONDS` | 预签名链接有效期，缺省 300 |

**AWS SDK 全部动态 import**：它体积很大，而绝大多数自托管实例用文件系统。
不配 S3 就永远不加载——与 BullMQ 的处理同一思路。

**对象键恒为 `<prefix>/<uuid>.bin`**，文件名进 S3 元数据而不进键。文件名是
任意用户输入，让它参与构造键就是自找路径注入。

### 三后端共用契约

`store-contract.test.ts` 让文件系统 / 内存 / S3 跑**同一组断言**。加后端最容易
出的事，是它在某个边角上和别人不一致，而那种差异要到生产才暴露。

这套契约当场就抓到一个：内存实现**不校验 id 格式**，把 `../../etc/passwd`
当成普通「找不到」返回 404，而文件系统实现把它识别为非法 id。校验松紧不一致的
后端，会让路径穿越在某一种部署形态下悄悄可行。现已统一到 `assertValidBinaryId`。

### 未做（明确留给后续切片，不半途而废）

- **Azure Blob**：又一个重量级 SDK，而 S3 协议已覆盖 MinIO/R2/Wasabi 等自建
  与云端方案。收益边际，单列。
- **执行数据外置**（`execution_data.data` → 对象存储指针）：这是数据模型改动，
  牵涉 pruning、worker 反序列化、归属校验多处，风险和工作量都远超一个 store 实现，
  必须独立切片。
- **multipart 上传接口**：需要新端点 + 节点 helper 契约扩展。
- **预签名下载接线**：`S3BinaryStore.presignedUrl()` 已实现，但下载路由仍走
  流式回传。接上它需要决定「何时重定向、何时代理」（跨域、审计留痕都受影响）。

---

## 十、C1 — 企业代码迁入 `packages/server/src/ee/`

### 为什么这不只是整理目录

`ee/` 是**授权边界**：LICENSE_EE 按这条路径划定商业授权范围。文件移进移出就
换了适用的许可证——移出去，那部分代码落回 Sustainable Use License，而 SUL
明文允许自托管者为自身业务目的修改软件，也就等于允许改掉验签解锁付费功能。

收益兑现：LICENSE_EE 第 2 节从**九条手工维护的路径**收成**一条 glob**
（`packages/server/src/ee/**`）。原先那份清单靠测试守着，但终究会随重构漂移。

### 迁入的模块

```
ee/license/{license-cert,license-service}.ts
ee/sso/{oidc-service,saml-service,router}.ts
ee/scim/{scim-service,router}.ts
ee/ldap/ldap-service.ts
ee/services/{audit,quota,secrets,log-streaming,git}-service.ts
```

### ★迁移暴露的结构性纠缠（未解，已登记）

C1 原计划「反转依赖方向：社区侧只留一个 registerEeRoutes 钩子」。实际做下来
发现问题比路由更深——**三个企业服务被社区核心代码直接依赖**：

| 社区文件 | 依赖的 ee 服务 | 为什么 |
|---|---|---|
| `services/execution-service.ts` | QuotaService | 计数是社区行为，只有**限额**是付费 |
| `services/credential-service.ts` | SecretsService | `{{ $secrets.X }}` 解析在凭证注入路径上 |
| `triggers/active-workflow-manager.ts` | AuditService | 写入始终进行，只有**查询**门控 |
| `billing/billing-service.ts` | AuditService | 同上 |

这不是疏忽，是这三个服务本身**半社区半企业**。正确解法是依赖倒置：社区侧定义
端口（接口 + 空实现），ee 侧提供适配器——与本仓库已有的
`IEncryptionKeyProvider` / `ISecretsProvider` 同一手法。

在还清之前，这四条边被显式钉在 `__tests__/ee-boundary.test.ts` 的待偿清单里：
**只减不增**，加新的一条测试就红；还清了却忘记从清单删除，另一条测试也会红。

### C1 下半场（已落地）

**依赖倒置** —— 那四条社区 → ee 的边，按各自的**真实性质**分别解决，
不是同一个模式套四遍：

| 边 | 真实性质 | 解法 |
|---|---|---|
| Audit | 写入始终进行，只有**查询**门控 | 写入器本就属于社区，搬回 `services/` |
| Quota | 计数始终进行，只有**限额**付费 | 拆成社区 `CountingUsageGate` + ee 限额包装 |
| Secrets | `{{ $secrets.X }}` 解析**整体**付费 | 社区定端口 `ISecretResolver`，缺省不注入 |

**路由抽取** —— 17 条完全属于企业的路由（审计查询 / 日志流 / 外部密钥 /
源码同步 / SSO·SCIM·LDAP 配置）搬进 `ee/routes.ts`，社区侧只留一句
`registerEeRoutes(router, services)`。`controllers/index.ts` 从 1901 行降到 1682。

路由共用的无状态辅助（`h` / `auth` / `param` / `parseBody` / `recordAudit` /
`assertInstanceAdmin` / `assertOwnerOf`）抽到 **`src/http/route-helpers.ts`**——
刻意不放 `controllers/` 下：那会让 ee 看起来在反向依赖社区的路由注册层，
而这条边界必须干净。

剩余的社区 → ee 依赖只有组装层与路由层（`bootstrap` / `app-services` / `app` /
`controllers/index`），它们的职责就是认识两侧。业务代码已清零。

### 仍未做

- **混合区段未拆**：`/projects` 与 `/quota` 上社区与企业行为交织在同一资源——
  GET 列表/用量是社区行为，POST/成员管理/限额才受门控。拆它需要先按「读/写」
  重新切路由，属独立改动，未夹带。
- **C2 lint 规则**：目前靠 `ee-boundary.test.ts` 守边界。测试能覆盖，
  但 lint 报错更早、反馈更快。
