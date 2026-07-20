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

- 公钥内置于 `license-cert.ts` 的 `DEFAULT_LICENSE_PUBLIC_KEY`，可由
  `NOMOPS_LICENSE_PUBLIC_KEY`（base64 DER/SPKI）覆盖。
- **私钥只在签发方**。实例只验不签，仓库里没有也不该有私钥。
- 工具：`scripts/license-keygen.mjs` 生成密钥对，`scripts/license-sign.mjs` 签发。

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
