# 11 — Cloud 架构演进：Postgres + 中央账户 + 中央订阅

> docs/09 立起了「实例-per-租户 + 控制平面编排」的骨架，但只分离了**实例生命周期**。
> 账户注册、订阅计费当时仍散在每个租户实例里（docs/09「未覆盖」清单）。
> 本文把 Cloud 补齐到基线 Cloud 的真实形态：**控制平面 = 账户门户 + 编排 + 计费三合一**。
>
> ★铁律不变：控制平面零 `@nomops/*` 依赖；内核三层解耦与 `projectId` 归属边界一行不改。

---

## 一、目标：两层，各管各的

对齐基线 Cloud（`app.<域名>` 门户 ↔ `<slug>.app.<域名>` 实例）：

| 层 | 归它管 | 存储 |
|---|---|---|
| **控制平面（运营管理端）** | 门户账户、实例登记、订阅/plan/配额、开通/挂起/删除 | 自有 **Postgres**（生产）/ SQLite（本地） |
| **每个租户实例** | 该租户的 workflow / credential / execution / 实例内用户 | 各自 **Postgres**（Cloud）/ SQLite（自托管） |

**分家原则**：账户与订阅属于控制平面；workflow 数据属于实例。二者靠一条 owner 关系挂钩——
门户账户开的实例，把该账户作为实例的 owner 注入（实例首用户绑定门户账户邮箱）。

**自托管不变**：单实例、SQLite 默认、账户与计费仍在实例内。双形态靠同一套代码 + 配置区分，
这正是 `@nomops/db` 双方言（SQLite↔Postgres，PGlite 进程内可测）的价值兑现。

---

> **落地记录**：Cloud 库选用 **Supabase**（单个 Postgres database，session pooler）。
> 单库约束 → 采用 **schema 隔离**：控制平面独占 `control_plane` schema，租户实例各用
> `tenant_<slug>` schema（后续 Phase）。`CREATE SCHEMA` 已验证可用（PostgreSQL 17.6）。
> 连接串放 gitignored `.env.cloud.local`（`CP_STORE_DB_URL`），绝不进 git。

## 二、Phase 1 — Cloud 走 Postgres ✅ 完成

### 1a. 租户实例走 Postgres
- `tenantEnv` 泛化 DB 注入：`dbMode: 'sqlite' | 'postgres'`。
  - `postgres` + 本地/测试 → 注入 `DB_TYPE=postgres` + `DB_DATA_DIR=<dataDir>/pg`（server bootstrap 用
    **PGlite 持久化**，每租户独立目录 = 真隔离、全本地、可测）。
  - `postgres` + 生产 → 注入 `DB_TYPE=postgres` + `DB_POSTGRES_URL`（由 url 模板 `…/nomops_{slug}` 解析，
    每租户独立 database）。
- control-plane 配置 `CP_TENANT_DB=postgres|sqlite`（默认 sqlite；Cloud 设 postgres）。
- server bootstrap 无需改动：`DB_TYPE/DB_POSTGRES_URL/DB_DATA_DIR` 早已支持。
- **已实现**：`tenantEnv` 泛化为 `TenantDbConfig`（[driver.ts](../packages/control-plane/src/drivers/driver.ts)），
  ProcessDriver/DockerDriver 按 `tenantDb` 注入。单测 `tenant-env.test.ts` 锁定三种 env 输出。
- 待办：Supabase 单库下租户走 `tenant_<slug>` schema（需 `@nomops/db` 加 `schema` 选项，设 search_path
  + `migrationsSchema` 让每租户独立迁移跟踪）——留到租户上量时做，当前 dataDir/PGlite 已够本地验证。

### 1b. 控制平面登记库走 Postgres ✅ 完成
- ★约束：反代**热路径**（每请求 + 每次 WS 升级）同步调 `registry.findBySlug`。
  异步 Postgres 不能直接塞进热路径。
- 方案：**Postgres 做持久源 + 内存索引供同步读**。`TenantRegistry` 抽象出 `ITenantStore`
  （[tenant-store.ts](../packages/control-plane/src/tenant-store.ts)）：
  - `SqliteTenantStore`（better-sqlite3，本地/自托管）
  - `PostgresTenantStore`（`SqlExecutor` 抽象，pg.Pool 连 Supabase / PGlite 单测两用），schema `control_plane`
  - Registry `init()` 灌满内存 Map（slug→tenant），写落库 + 更新 Map，`findBySlug/findAll` 恒同步返回。热路径零 await。
- **验证**：`tenant-store.test.ts` 双存储契约 + schema 隔离 + 异步写→同步读一致性（PGlite）；
  另经**真实 Supabase** 冒烟：create→重开 registry 从库读回→DROP smoke schema 清理，全通过。
- main.ts：`CP_STORE_DB_URL` 存在 → PostgresTenantStore(Supabase)，否则 SqliteTenantStore。

---

## 三、Phase 2 — 账户上移到控制平面 ✅ 完成

- control-plane `control_plane.accounts`（id / email / password_hash / created_at）+ 注册/登录 API。
  口令用 **scrypt**（salt:hash），门户令牌用 **HMAC-SHA256** 极简 JWT——零新增依赖（沿用轻依赖取向）。
  账户领域对象**不含**密文，令牌校验才读 hash（铁律 3 延伸）。
- `tenants.account_id`：一账户多实例（`accounts`↔`tenants` 一对多）。
- 开实例：`POST /account/instances`（门户令牌鉴权）→ `provision({ accountId, email, slug })`，
  账户邮箱作为实例 owner：driver 注入 `NOMOPS_OWNER_EMAIL`，server bootstrap 首启 `ensureOwner` 建该 owner。
- `GET /account/instances`：只列本账户名下租户（归属隔离）。
- 门户页 [portal.ts](../packages/control-plane/src/portal.ts) 替换 `/signin`：登录/注册 → 「我的实例」看板 → 进入/开通。
- **验证**：`account.test.ts` 双存储契约（注册/登录/令牌/篡改）；`control-plane.test.ts` 账户流
  （注册→开真实实例→我的实例列出→归属隔离）；server `owner-provision.test.ts`（ensureOwner 幂等）；
  门户 UI 浏览器实测（注册→看板→开通表单）；**真实 Supabase** 冒烟（account 落库、scrypt 密文、清理）。
### Phase 2.5 — 门户→实例免密登录 ✅ 完成
- 控制平面给每个实例注入**共享 HMAC 密钥** `NOMOPS_HANDOFF_SECRET`（+ `NOMOPS_TENANT_SLUG`）。
- 门户「进入」→ `POST /account/instances/:slug/enter`（账户鉴权+归属校验）→ `mintHandoff` 签短时效
  （60s）令牌绑定 (owner 邮箱, slug) → 返回 `<实例>/auth/handoff?token=…`。
- 实例 `GET /auth/handoff` 用同密钥验签 + slug 绑定 + 过期校验 → `auth.sessionForEmail` 给 owner 签发会话
  → HTML 落地把会话令牌写 localStorage 再 `replace('/')`。**handoff 令牌只在 URL，会话令牌只在 body**。
- 两包无共享代码，`mintHandoff`/`verifyHandoff` 各存一份（对称 HMAC）。
- **验证**：control-plane `handoff.test.ts`（签验/过期/篡改）+ `control-plane.test.ts` 端到端
  （enter→真实实例 handoff→会话可访问 API + 异账户 404）；server `handoff.test.ts`（过期/slug 不符/异密钥/未知邮箱 → 401）；
  浏览器实测：门户点「进入」→ 直接落到实例 Overview（无二次登录），且 free 档 `0/100 Executions` 配额可见。
- 安全取舍：共享密钥全实例通用（实例是我方代码，低风险）+ slug 绑定做纵深防御；单次性靠短 TTL（未做 nonce 记账）。

## 四、Phase 3 — 订阅/计费上移到控制平面 ✅ 完成（中央订阅 + plan 下发）

- `control_plane.subscriptions`（tenant_slug PK / plan / status / period_end）= plan 唯一真相源。
  `PLAN_SPECS`：free(配额100)·pro(10000)·enterprise(不限+企业功能)，对齐营销站三档。
- **plan 下发**：`planEnv(plan)` → `NOMOPS_PLAN` / `NOMOPS_PLAN_QUOTA` /（企业档）`LICENSE_KEY`。
  driver `start(tenant, extraEnv)` 接收；Provisioner 编排（起实例前解析订阅算 env）。
  实例 bootstrap 把 `NOMOPS_PLAN_QUOTA` 幂等落到 owner 项目配额（只读接收，升级重启即生效）。
- **升级**：`POST /account/instances/:slug/plan`（账户鉴权 + 归属校验）→ `changePlan` 改订阅 + 重启实例下发。
  门户看板每个实例一个 plan 下拉（社区版/Pro/企业版），选中即升级。
- **验证**：`subscription.test.ts` 双存储 + planEnv 映射 + extraEnv 覆盖；`control-plane.test.ts`
  升级流（默认 free→enterprise→中央订阅变更+实例重启+归属校验 404）；server `owner-provision.test.ts`
  配额下发落地（有限值/unlimited）；门户 UI 浏览器实测（开实例→plan 下拉→升级→重启后 running）；
  **真实 Supabase** 冒烟（subscription 落库、setPlan、清理）。
- 未做（本次范围外）：真实支付宝收银上移（选了「中央订阅 + plan 下发」档，不接真实支付）；
  free 档的强制限流（现状：企业档 license 才强制，free 仅计数——沿用既有语义）。
  运营台 `/admin` 订阅视图已在 Phase 4 补齐。

---

## 五、Phase 4 — 独立运营管理端（`@nomops/admin`）✅ 完成

补齐 Phase 3 遗留的「运营台订阅视图」，并升级为独立 SPA 运营控制台。

### 5a. 运营 API（控制平面 `/cp/*`，admin token）
- `GET /cp/tenants` **富化**：registry 租户 + 中央订阅(plan/label/status/周期) + owner 邮箱 + 可访问 url + 真实用量。
  additively 追加字段，旧内联台不破。
- `GET /cp/overview`：租户状态分布 + 中央订阅 plan 分布 + 账户数 + 聚合执行量。
- `GET /cp/accounts`：门户账户 + 名下实例聚合（`IAccountStore.loadAll` 返回领域对象，密文不出 API，铁律 3）。
- `GET /cp/plans`：暴露 `PLAN_SPECS`，前端不硬编码套餐。
- `POST /cp/tenants/:slug/plan`：运营端代改套餐 → `provisioner.changePlan` 改中央订阅 + 重启下发。
- **套餐口径对齐**：开通表单 `free|pro|enterprise`（`paid` 作 enterprise 别名，向后兼容）。
  provision 加 `subscriptionPlan`：中央套餐 → registry plan 按「是否企业档」映射（enterprise→paid / 其余→free），
  首启即正确下发，不多做一次重启。

### 5b. 降级修复（planEnv 成为 LICENSE 权威）
- 旧路径：`tenantEnv` 按 registry `plan==='paid'` 注入企业 LICENSE；`planEnv('free')` 不含 LICENSE_KEY 键 →
  降级 enterprise→free 时旧企业 key **残留**（末位覆盖漏清）。
- 修：`planEnv` **恒下发** `LICENSE_KEY`（企业+有 key→真 key，否则空串）。空串经末位覆盖清除残留，
  server 判定空 LICENSE = community。运营端降级现在**真关闭**企业功能。

### 5c. 真实用量/指标（唯一新增内核 HTTP 面）
- 实例加 `GET /internal/usage`（[controllers/index.ts](../packages/server/src/controllers/index.ts) `createInternalRouter`）：
  共享密钥 `NOMOPS_INTERNAL_TOKEN` 鉴权（非用户会话，`timingSafeEqual`），返回 owner 项目聚合
  `{period,used,limit,plan}`。**未注入密钥（自托管）→ 端点 404**（形态开关）。只回聚合计数，不出凭证（铁律 3）。
- 驱动注入 `NOMOPS_INTERNAL_TOKEN`（缺省 `internal:<adminToken>`）；控制平面 `probeUsage(port)` best-effort
  拉取各 running 实例用量（1.5s 超时、不可达/无密钥→null，不阻塞视图），灌进富化租户 + 概览聚合。

### 5d. 独立运营 SPA（`packages/admin`，Cloud 专属）
- Vite+Vue3+router+pinia，`base:/admin/`；视图 登录门/概览/租户/订阅/账户；深色+橙(#ff6900) 运营台观感。
- 控制平面 `/admin` 从内联 HTML 改为**托管 `admin/dist`**（history 回退；dist 不存在则回落内联台，无构建也可用）。
- SPA 独立构建，控制平面**只托管 dist、不 import**——仍零 `@nomops/*` 依赖。

### 5e. 双形态产物边界收紧（[docker/Dockerfile](../docker/Dockerfile)）
- 自托管镜像原 `COPY packages + pnpm build` 会「捎带」control-plane/admin（死代码）。
- 改为 `turbo run build --filter=@nomops/server... --filter=@nomops/frontend...`（只构建实例包），
  构建后 `rm -rf` control-plane/admin 包 + node_modules 软链 → 镜像**不含任何 cloud/运营字节**。

### 验收
- 单测：control-plane 70（+运营 API/降级/用量探针）；server 137（+`/internal/usage`）；全 6 业务包隔离全绿(300)。
- 浏览器实测：登录→开通真实实例(enterprise)→改套餐(降级重启)→真实用量(free 0/100·pro 0/10000)→横向滚动。
- turbo `--dry` 断言 filter 只选 6 实例包、排除 control-plane/admin。

---

## 五点五、接线缺口收尾（对标基线审计后）

三端「页面 ↔ 接口」审计后补齐的缺口：

- **清死链/占位**：登录/注册 ToS·Privacy → 真实 `/docs/terms`·`/docs/privacy`（法务占位页，明示可替换）；
  营销页脚 2 死链 → 新建真实 `/self-hosted` 页（真实 docker compose 快速上手 + `#docs`）；
  移除 Executions 禁用 Filter 按钮、数据表「Import CSV · Coming soon」占位。
- **打通「后端有·前端缺」**：Settings→Usage and plan 加「Admin · project quota override」控件
  （owner/admin + 企业版 quotas 门控）→ 复用既有 `PUT /api/projects/:id/quota`。
- **门户账户自服务**（Cloud 门户，对齐应用门户形态）：
  - 忘记密码/重置：`password_resets` 表（存 token 的 sha256 哈希，1h 过期、一次性）；
    `/account/forgot`（恒回 ok，不枚举邮箱；无邮件基础设施 → 重置链接打服务端日志）→
    `/account/reset`（`?reset=token` 落地页设新口令）。
  - 账户设置：`/account/change-password`·`/account/change-email`（均需当前口令；改邮箱返回新令牌，
    既有实例 owner 邮箱不追溯）。
  - **验证**：`account.test.ts` 双存储 +8 用例（重置/一次性/过期/改密/改邮箱/占用）；门户端到端浏览器实测
    （忘记→日志取链→重置→新口令生效旧失效→改邮箱→改密码，均经 API 复核）。

---

## 五点六、架构调整：控制平面收敛为「运营代开」形态

> 决策：Cloud 采用**运营代开**模式——运营方在运营台开实例，客户直接使用各自实例（`<slug>` 域）的
> 自带登录/UI。控制平面**不再对外提供任何客户网页**。

**已从控制平面移除**（面向客户的一切）：
- 营销站（`marketing.ts`：`/` `/pricing` `/templates` `/self-hosted`）、落地页（`landing.ts`）、
  账户门户（`portal.ts`：`/signin`）及公开自助路由（`/instance/resolve`、`/instance/provision`）。
- 门户账户体系（`account-service.ts` / `account-store.ts` / `/account/*` / `password_resets`），
  即 Phase 2 账户 + Phase 5.5 账户自服务——运营代开不需要客户自助账户。
- 运营台的「账户」视图（`/cp/accounts` + admin SPA AccountsView + 概览账户数）。

**控制平面现在只剩**：
- 运营台 `/admin`（@nomops/admin SPA）+ 运营 API `/cp/*`（概览/租户/订阅/plans/开通/代改套餐/暂停恢复删除）。
- 租户编排后端（provisioner / registry / drivers / 中央订阅）+ 租户域反向代理（含 WS）。
- `GET /` → 302 重定向到 `/admin`（无对外客户页）。

**客户网站 = 实例前端（`@nomops/frontend`）**：营销 + 登录 + app 一站齐全，每租户一份。
> 营销站重复问题（前端 vs 控制平面）由此自然消解——控制平面侧的那套已删，只留前端一套。

**验证**：control-plane 49 测全绿（真实进程 `control-plane.test.ts` 覆盖 `/`→`/admin`、客户页 404、
`/cp/*` 鉴权与租户生命周期）；ops-only 实例冒烟（正确 token 下 `/cp/*` 通、`/cp/accounts` 与 `/signin` 均 404）。

---

## 五点七、仓库分离：实例产品 ↔ Cloud 编排层（对齐基线公开仓/私有云的分法）

> 决策：Cloud 编排层抽到独立仓库，两仓零代码耦合（Cloud 层本就零 `@nomops/*` 依赖，
> 对实例的全部“了解”只有镜像名/入口路径/env 约定——网络边界的仓库级兑现）。

| 仓库 | 内容 | 远端 |
|---|---|---|
| **nomops**（本仓库） | 实例产品：workflow/core/db/nodes/server/frontend。自托管形态 = 本仓库镜像；Cloud 租户跑的也是它 | `github.com/nomops/nomops` |
| **nomops-cloud** | Cloud 编排：control-plane + admin 运营台 + 自有 Dockerfile/workspace/lockfile | `github.com/nomops/nomops-cloud` |

- **路径解耦**：control-plane 对实例产物的默认路径为候选探测（同仓 `cloud/` 布局 → 兄弟 `nomops`
  检出），env（`CP_SERVER_ENTRY`/`CP_STATIC_DIR`）可覆盖；真实进程 E2E 找不到实例产物时自动跳过。
- **本仓库不再有** control-plane/admin：workspace/turbo/launch.json/Dockerfile 均已清理；
  Dockerfile 无需再剔除 cloud 包（物理不在）。
- **验证**：nomops 230 测全绿（6 包）；nomops-cloud 独立安装/构建/49 测全绿
  （E2E 经兄弟检出真实拉起实例）。

---

## 六、验收原则（每 Phase）
- 单测（PGlite 双存储 / spawn Postgres 实例跑通全流程）+ 浏览器实测 + 全量回归绿。
- 控制平面仍零 `@nomops/*` 依赖（`/admin` 只托管 dist、经 HTTP 调实例，不 import）。
- 内核 `packages/server` 及以下无 diff——**例外**：Phase 4 加了一条只读指标面 `/internal/usage`
  （共享密钥、经网络边界、不出凭证），属新增运营切片的正当 HTTP 面，未触三层解耦与 `projectId` 归属边界。
- 自托管形态不回归：SQLite 默认、单实例、账户/计费在实例内；镜像不含 cloud/运营字节——同一套代码，配置区分。
