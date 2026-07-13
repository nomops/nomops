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
