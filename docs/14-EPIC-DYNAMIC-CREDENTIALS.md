# 14 — EPIC-DYNAMIC-CREDENTIALS：动态凭证（backlog #46 规划文档）

> 状态：**规划 + 动工**（backlog #46，`L/XL`，2026-07-24 触发立项）。对标基线的 embed/白标场景
> 「动态凭证」：一个逻辑凭证在运行时按**租户/终端用户（subject）**解析成不同的实际值。
>
> nomops 现状：凭证是「id → 固定密文 → 解密值」。本 Epic 引入**解析器（resolver）**间接层——
> 标记为 `resolvable` 的凭证不存固定值,而是在执行时经解析器按当前 subject 取值。

---

## 一、目标与边界

**目标（embed / 白标 / 多租户）**：宿主把一个工作流嵌进自己产品,给 N 个终端用户跑。工作流里
只引用**一个逻辑凭证**（如「Slack」）,但每个终端用户有自己的 Slack token。运行时按 subject
解析出该用户的实际值注入节点——工作流定义零改动,凭证值随 subject 变。

**不做（本 Epic 之外）**：
- 不改引擎/core/节点。解析发生在 server 层唯一 choke point（`getDecryptedData`），与 `$secrets`
  同一处；引擎只认 `getCredentials(type,node) → Promise<data>`。
- 不做通用密钥托管（那是 `$secrets` 外部密钥 / KMS 每租户密钥,已另有抽象）。
- 不与 #47 实例信任密钥链合并。

**依赖 / 复用**：
- **choke point**：`CredentialService.getDecryptedData(id, projectId)` —— 解析器在此切入
  （与 `secrets.resolve()` 相邻）。
- **加密栈**：entry/user_entry 的值本身是密文,复用 `Cipher`/`Credentials`/`IEncryptionKeyProvider`。
- **归属**：resolver/entry 按 `projectId` 归属,复用现有仓储边界（铁律 2）。
- **插件形态**：镜像 `ISecretsProvider`——可插拔解析器后端 + license 门。

**三条硬约束**：
1. **铁律 3**：解析出的实际值即用即弃——不落库、不出 API、不进日志。entry/user_entry 的
   `data` 存密文。
2. **零引擎改动**：解析只在 `getDecryptedData` 做；subject 经 additionalData 闭包贯通,不碰 core。
3. **非 resolvable 凭证行为完全不变**：只有 `resolverId != null` 才走解析分支。

---

## 二、数据模型

| 表 / 列 | 关键列 | 说明 |
|---|---|---|
| `credentials`（改）| +`resolver_id`(nullable) · +`is_resolvable`(bool) | 标记一个凭证为可解析并挂解析器。为空 = 老行为（固定密文）。 |
| `dynamic_credential_resolvers` | id, projectId, name, kind(table\|http), config(json), createdAt | 解析器定义。kind=table：值存 entry/user_entry；kind=http：运行时打宿主端点取值（M2）。 |
| `dynamic_credential_entries` | id, resolverId, subject, data(密文), createdAt, updatedAt | 按 **subject**（租户/终端用户标识串）的凭证值。unique(resolverId, subject)。 |
| `dynamic_credential_user_entries` | id, resolverId, userId, data(密文), createdAt, updatedAt | 按 **平台 user** 的凭证值（M2）。unique(resolverId, userId)。 |

> **决策**：`data` 密文复用凭证加密栈（同 `context.projectId` 密钥）。解析时解密 → 即用即弃。

---

## 三、里程碑（分批,各自可验收、单独提交）

- **M1 — 数据模型 + 表解析器 + getDecryptedData 贯通**（`M/L`）：
  3 表 + credentials 两列 + 迁移；`DynamicCredentialService` 含可插拔 `ICredentialResolver` +
  内置 **table 解析器**（按 subject 查 entry）；`getDecryptedData(id, projectId, subject?)` 在
  凭证 resolvable 时经解析器取值（仍过 `secrets.resolve`,不落库）；resolver + entry CRUD API
  （license 门 `dynamicCredentials`）；前端最小管理（标 resolvable、建 resolver、加/删 entry）。
  **验收**：标一个凭证 resolvable 挂 table 解析器 → 加两个 subject 的 entry → `getDecryptedData`
  按 subject 返不同值；非 resolvable 凭证不变；解析值不出 API/日志。

- **M2 — 运行时按 subject 贯通 + user_entry + HTTP 解析器**（`M/L`，靠 #46 M1）：
  subject 从运行上下文（触发时传入）贯通到 `buildAdditionalData` → `getCredentials` 闭包 →
  `getDecryptedData`；`user_entry`（按平台 user）；`http` 解析器（注入 fetch,打宿主端点按
  subject 取值,embed/白标）。**验收**：同一 workflow 同一凭证引用,run as subject X → 注入 X 的
  值；user 域 entry 生效；http 解析器按 subject 取值。

- **M3 — 管理台完善 + 审计 + 轮换**（`S/M`，收尾）：resolver/entry 管理 UI 完善、审计日志
  （谁改了哪个 subject 的值）、批量导入。**验收**：UI 全链管理；改动进审计。

**总量**：约 L/XL。M1 单独就是「按 subject 解析」的完整 service 级能力,可先交付；M2 把它接进
引擎运行；M3 打磨。

---

## 四、关键决策速查

1. **单一 choke point**：解析在 `getDecryptedData` 做,与 `$secrets` 相邻。引擎/core/节点零改动。
2. **铁律 3**：解析值即用即弃；entry 值存密文；API 视图永远剥离 data/config 里的密钥。
3. **subject = 运行时租户/终端用户身份**：M1 在 service 层收 subject（可测/可活验）；M2 从运行
   上下文贯通到引擎。缺 subject 时不静默取错值——按解析器策略 fail 或回退明确定义。
4. **可插拔解析器**：`ICredentialResolver` + 内置 table 后端；M2 加 http 后端。镜像 `ISecretsProvider`。
5. **license 门**：`dynamicCredentials` 企业特性（embed 是 Cloud/企业场景）,与 `externalSecrets` 同档。
6. **非 resolvable 零影响**：`resolver_id == null` 直接走老路径,不进解析分支。

---

## 五、风险与前置

- **subject 从哪来**：M1 由 API 显式传（测试/活验）；M2 需定义运行触发如何携带 subject（webhook
  header / 手动运行选 subject / 嵌入 SDK 传入）——判错会注错租户的值,是安全事故,需 fail-fast。
- **entry 爆炸**：N 租户 × M 凭证,entry 量大；需索引 + 后续清理策略。
- **http 解析器的可达性 + 缓存**：宿主端点每次运行都打会慢；需短 TTL 缓存（但缓存密钥 = 铁律 3
  风险,只在进程内存、不落盘）。
- **与 `$secrets` 的边界**：`$secrets` 是「按 key 取全局外部密钥」；动态凭证是「按 subject 取该凭证
  的值」。两者可叠加（entry 值里也可含 `{{ $secrets.KEY }}`,解析后仍过 secrets.resolve）。
