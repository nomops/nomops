# 07 — Phase 6b：SSO（OIDC）+ SCIM 用户预配

> 企业功能第二切片：单点登录 + IdP 侧用户生命周期管理。
> License 功能开关：`sso`、`scim`（沿用 docs/06 的门控机制）。

---

## 一、协议选型（本切片最大决策）

**SSO = OIDC（Authorization Code Flow），SAML 延后。**

理由：OIDC 是纯 HTTP + JWT，用认证过的 `openid-client` 库即可安全实现，且能在单测里
起一个进程内 mock IdP 完整验收；SAML 需要 XML 签名栈（xml-crypto 一族），
自研/浅封装都是安全高危区，对标 n8n 也是先 SAML 后补 OIDC 的历史包袱路线——我们反着走。
需要 SAML 的客户场景等真实需求出现再评估（多数现代 IdP：Okta/Azure AD/Auth0/Keycloak 都支持 OIDC）。

**SCIM = SCIM 2.0 Users 资源（RFC 7643/7644 子集），Groups 延后。**
Groups→projects 映射牵动 RBAC 语义，等团队项目用法稳定后做。

---

## 二、SSO（OIDC）设计

### 配置（实例级，存 settings 表）
```
settings['sso.oidc'] = JSON {
  enabled: boolean,
  issuer: string,           // 例 https://idp.example.com（走 /.well-known/openid-configuration 发现）
  clientId: string,
  clientSecret: <加密串>,    // ★经 Cipher（AES-256-GCM）加密后存储，铁律 3 精神
}
```

### 流程（Authorization Code + PKCE）
```
GET  /sso/status            公开：{ enabled }（前端据此显示 SSO 登录按钮）
GET  /sso/login             → 302 到 IdP authorize（state/nonce/PKCE 存短时内存态）
GET  /sso/callback?code&state
     → openid-client 换 token、验 ID token（签名/nonce/aud/exp）
     → 按 email 查用户：
        - 已存在且未禁用 → 登录
        - 不存在 → JIT 自动预配（建用户 + personal project，无密码：passwordHash 置随机不可用值）
        - 已禁用 → 403
     → 签发本系统 JWT → 302 到前端 /sso/done?token=<jwt>
```

### 管理 API
```
GET  /api/sso/config        [sso 功能][实例 admin]  返回配置（clientSecret 掩码）
PUT  /api/sso/config        [sso 功能][实例 admin]  写配置（secret 即时加密）
```

### 实例管理员
`users.role` 字段（docs/02 已有：owner|admin|member）正式启用：
**第一个注册用户 role='owner'**（自托管惯例），其余默认 member。
SSO/SCIM 配置类端点要求 `role ∈ {owner, admin}`。

---

## 三、SCIM 2.0 设计

### 鉴权
- 专用长效 Bearer token：`POST /api/scim/token`（实例 admin + scim 功能）生成，
  **仅生成时明文返回一次**，库里存 SHA-256 哈希（settings['scim.tokenHash']）。
- `/scim/v2/*` 全部用该 token 鉴权，错 token → 401。

### 端点（Users 子集）
```
GET    /scim/v2/Users                    列表；支持 filter=userName eq "x"（IdP 查重用）
GET    /scim/v2/Users/:id
POST   /scim/v2/Users                    创建（JIT 等价物；userName=email）
PUT    /scim/v2/Users/:id                整体替换（name/active）
PATCH  /scim/v2/Users/:id                Operations 子集：replace active / name
DELETE /scim/v2/Users/:id                软删（active=false），不物理删
```
- SCIM Schema：`urn:ietf:params:scim:schemas:core:2.0:User`，响应含 ListResponse 包装。
- 映射：`userName`=email、`name.givenName/familyName`=firstName/lastName、`active`=!disabled。

---

## 四、数据模型增量（对 docs/02 的扩展）

```typescript
// users 表加一列（迁移 0002）
disabled: boolean('disabled').notNull().default(false)
```
- 登录（密码 & SSO）与 JWT 鉴权中间件均拒绝 disabled 用户（401/403）。
- SCIM 的 deactivate = 置 disabled，会话级立即生效（中间件每请求查用户？——
  不查，成本高；折中：登录时查 + SCIM 停用时该用户 token 最长 7 天残留。
  ★如需立即吊销需 token 黑名单，本切片不做，写入已知边界。）

---

## 五、审计增量

新增动作：`auth.sso.login`、`sso.config.update`、`scim.token.create`、
`scim.user.create`、`scim.user.update`、`scim.user.deactivate`。

---

## 六、依赖

- `openid-client`（认证过的 OIDC RP 实现）
- `jose`（测试用 mock IdP 的密钥/签名；纯 JS）

---

## 七、验收标准（全部单测，mock IdP 进程内起）

- [ ] OIDC 全流程：/sso/login 302 参数正确（state/PKCE）→ mock IdP 发 code →
      /sso/callback 换 token、验 nonce → 新用户 JIT 预配（含 personal project）→
      拿到的 JWT 能访问 /api/workflows
- [ ] 二次 SSO 登录复用既有用户（不重复建）
- [ ] disabled 用户：密码登录 401、SSO 回调 403
- [ ] SCIM：POST 建用户 → filter 查到；PATCH active=false → 密码登录立即 401；
      DELETE = 软删；错 token → 401
- [ ] License 门：社区版 /sso/login、/scim/v2/*、配置端点全部 403 带 feature
- [ ] clientSecret 密文入库（不含明文）；GET config 返回掩码
- [ ] 第一个注册用户 role=owner，非 admin 用户碰配置端点 403
- [ ] 既有 126 测零回归
