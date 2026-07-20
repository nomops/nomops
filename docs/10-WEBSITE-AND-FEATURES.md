# 10 — 官网 + 实例内高级特性（对标基线全景）

> 实地分析对标站点（首页/定价/模板库）与实例内功能后的开发规划。
> 原则：采用其页面结构与交互模式；文案/数据/品牌全部 nomops 自有，不造假内容。

---

## 一、对标站点页面结构分析（实地抓取）

### 首页
```
导航条：logo | 产品▾ 用例▾ 文档▾ 社区▾ 企业 定价 | GitHub星数 登录 [开始使用]
Hero：超大标题（两行）+ 双 CTA（主渐变 + 次级）+ 一句副题 + 客户 logo 条
画布演示区：交互式工作流画布截图 + 左侧「角色 can 做什么」列表
社会证明：三张卡（GitHub / 评分 / 社区规模）
功能区块 ×4：集成数 / AI 能力 / 代码+UI 双模式 / 快速迭代（每块标题+副题+要点列表）
企业区：标题 + 四宫格（安全管控/可观测/开发体验/AI 治理）
评价墙：多列用户评价卡
底部 CTA：大标题 + 按钮
页脚：多列链接
```

### 定价页（/pricing）
```
标题 + 两行副题（按执行计费说明）
月/年切换开关
四档套餐卡：名称/适用人群/价格/执行额度选择器/CTA/托管方式标注
```

### 模板库（/workflows）
```
居中大标题（带模板计数）+ 搜索框 + 分类 chips（AI/Sales/IT Ops/…）
精选区块（「新手必学」等）+ 模板卡片流
```

---

## 二、开发规划（一步一步）

### Step A1 — 营销站（control-plane 托管）
- `/` 营销首页：导航 + hero + 画布示意 + 功能区块 + 企业四宫格（映射 nomops 真实能力：
  SSO·RBAC·审计·配额·多租户）+ CTA + 页脚。真实数据（节点数/测试数/双方言）不造假。
- `/pricing` 定价：月/年切换 + 三档卡（社区自托管 Free / Pro ¥99/月 / 企业 联系）→ 接支付宝
- `/templates` 模板库：搜索 + 分类 + 模板卡（与实例内模板同数据源）
- 实例入口从 `/` 移至 `/signin`（对齐 「官网 ↔ 应用门户」分工）

### Step B1 — Templates（实例内模板库）✅ 完成
- server：内置模板注册表（真实可跑的 workflow JSON）+ `GET /api/templates` + 导入=建流
- frontend：侧栏「模板」页（画廊 + 一键导入进画布）

### Step B2 — AI Assistant ✅ 完成
- server：`POST /api/assistant/chat` 调 Claude API（实例配置的 anthropicApi 凭证），
  system prompt 注入 nomops 节点知识；返回 workflow JSON 建议（结构校验后才交前端）
- frontend：侧栏「✨ AI 助手」右侧滑入聊天面板 + 「⚡ 应用到画布」（建流并跳转）
- 铁律 3：apiKey 仅在调用瞬间解密使用，不落库/不出 API/不进日志

### Step B3 — Log Streaming（企业）✅ 完成
- server：`LogStreamingService` 管理 webhook 目的地（存 settings），执行结束事件（ExecutionService
  旁路）+ 审计事件（AuditService 旁路）fire-and-forget 推送；HMAC-SHA256 签名放 `x-nomops-signature`
- feature key `logStreaming`（社区版 403）；`/api/log-streaming/destinations` CRUD + `/:id/test`
- Settings「📡 日志流」：目的地管理 + 订阅事件勾选 + 测试发送；**密钥绝不出 API**（列表只回 secretConfigured）
- 6 个集成测试（进程内接收器）：门控 / 脱敏 / 签名 / 执行推送 / 事件订阅过滤

### Step B4 — External Secrets（企业）✅ 完成
- server：`ISecretsProvider`（可插拔，当前 `EnvSecretsProvider` 读 `NOMOPS_SECRET_<KEY>`）+
  `SecretsService`；`CredentialService.getDecryptedData` 在注入瞬间深度解析 `{{ $secrets.KEY }}` →
  真值。未启用企业版检测到引用 → 403；引用缺失 key → fail-fast 报错（不静默空值）
- feature key `externalSecrets`；`GET /api/external-secrets` 只回 provider + key 名清单
- Settings「🔑 外部密钥」：provider 状态 + 可用 key 名（**值永不显示**）+ 引用用法说明
- 6 个集成测试：门控 / 状态脱敏 / 引用物化 / 缺失 key 报错 / 社区版拦截 / 普通凭证不受影响

### Step B5 — LDAP（企业）✅ 完成
- server：`LdapService`（bind 登录 + JIT 复用 `auth.loginViaSso`）；真实 `LdaptsAuthenticator`（ldapts）
  经 `ILdapAuthenticator` 抽象隔离，测试注入假认证器做协议无关的逻辑验证。配置存 settings，
  bindPassword 经 Cipher 加密；`getMaskedConfig` 绝不回明文（RFC4515 过滤器转义防注入）
- feature key `ldap`；`/api/ldap/config` GET/PUT（admin）+ 公开 `/auth/ldap/login`、`/auth/ldap/status`
- Settings「🗂️ LDAP」配置表单 + 登录页「使用 LDAP 登录」切换（用户名/密码）
- 7 个集成测试：门控 / 配置脱敏 / status / bind 登录 + JIT / 错误密码 401 / 未启用 403 / 省略密码保留原值

---

## 三、验收原则
- 每步：单测 + 浏览器实测 + 全量回归绿
- 企业特性全部走 license feature 门（社区版 403 带 feature 标识）
- 凭证/密钥类永不出 API 明文（铁律 3 延伸到 secrets/LDAP bind 密码）
