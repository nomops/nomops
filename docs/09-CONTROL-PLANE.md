# 09 — Phase 6d：多租户控制平面（Cloud 形态）

> docs/01 双形态的兑现：Cloud = 我们替用户跑同一个 Node 应用，外面加控制平面。
> ★架构铁律（docs/01）：控制平面是**独立编排层**，经网络边界与内核通信，
> 绝不缠进核心数据模型——内核零改动是本切片的硬验收项。

---

## 一、核心架构决策

### 1. 租户模型 = 每租户独立实例（instance-per-tenant，对标 n8n Cloud）
不做共享库多租户。理由：
- docs/01 明确「为每租户 provision 实例、路由、隔离」
- 内核完全不用知道租户的存在（隔离在进程/容器边界，天然最强）
- 共享库多租户会把 tenantId 缠进所有表——正是 docs/01 警告的反模式

### 2. 实例驱动抽象（本切片可测性的关键）
```typescript
interface IInstanceDriver {
  start(tenant: Tenant): Promise<{ port: number }>;
  stop(tenant: Tenant): Promise<void>;
  isRunning(tenant: Tenant): boolean;
}
```
| 驱动 | 用途 | 本机验收 |
|---|---|---|
| `ProcessDriver` | 本地开发/测试：spawn `node server/dist/main.js`，每租户独立端口 + 独立 SQLite 数据目录 | ✅ 全流程真实验收 |
| `DockerDriver` | 生产单机：`docker run` 每租户一容器 | ⚠️ 代码就位，本机无 Docker 不能机验 |
| k8s driver | 生产集群 | 后续切片 |

### 3. 路由 = Host 头反向代理
`<slug>.<CP_BASE_DOMAIN>` → 对应实例端口（含 WebSocket upgrade 透传）。
测试直接设 Host 头，无需真实 DNS。未知租户 404；suspended 503。

### 4. 控制平面 = 新包 `packages/control-plane`，零 @nomops/* 导入
对内核的全部“了解”只有部署配置（server 入口路径 / docker 镜像名 / 环境变量约定）。
这是「网络边界」的代码级证明——CI 可断言其 package.json 无内核依赖。

---

## 二、租户生命周期

```
POST   /cp/tenants {slug, email, plan}   → provisioning → 起实例 → 等 healthz → running
GET    /cp/tenants                        列表（含状态/端口）
POST   /cp/tenants/:slug/suspend          停进程 → suspended（代理回 503）
POST   /cp/tenants/:slug/resume           重新起 → running
DELETE /cp/tenants/:slug                  停进程 → deleted（代理 404；数据目录保留=软删）
```
- 管理 API 鉴权：静态 admin token（env `CP_ADMIN_TOKEN`），错/缺 → 401。
- 控制平面自有存储：独立 SQLite（`tenants` 表），与内核库完全无关。
- slug 规则：`[a-z0-9-]{3,40}`，唯一。

## 三、套餐接线（与 6c 呼应）

provision 时按 plan 注入实例环境变量：
- `paid` 计划 → `LICENSE_KEY=<cloud key>`（实例内企业功能全开，配额由实例内 6c 机制管）
- `free` 计划 → 不注入（社区版行为）
每实例还注入：`PORT`、`DB_SQLITE_FILE=<dataRoot>/<slug>/nomops.db`、`NOMOPS_BASE_URL`。

## 四、tenants 表（控制平面私有，非内核契约）

```typescript
tenants: {
  id uuid pk, slug text unique, name text, email text,
  plan text ('free'|'paid'), state text ('provisioning'|'running'|'suspended'|'deleted'),
  port integer nullable, createdAt timestamp
}
```

## 五、不做（后续切片）

自助注册 UI、计费扣款、备份/恢复、TLS 终结（前置 nginx/traefik）、
k8s 驱动、跨实例监控面板。

## 六、验收标准（ProcessDriver，全部本机真实进程）

- [ ] provision 两个租户 → 两个真实 nomops 进程、不同端口、各自 healthz 通
- [ ] 经代理（Host 头）在租户 A 跑通全流程：注册→登录→建流→运行→查历史
- [ ] 隔离：两租户可注册同一邮箱（各自独立用户）；A 的 workflow 在 B 完全不可见
- [ ] plan 接线：paid 租户 /api/license = enterprise；free 租户 = community
- [ ] suspend → 代理 503；resume → 恢复可用；未知 slug → 404；deleted → 404
- [ ] 管理 API：错误 token 401；slug 冲突 409；非法 slug 400
- [ ] ★内核零改动：packages/server 及以下无任何 diff；control-plane 无 @nomops/* 依赖
- [ ] 既有 149 测零回归
