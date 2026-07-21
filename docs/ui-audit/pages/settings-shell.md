# 页面审计 · Settings 壳 + 子页 P1

- 基线路由：`/settings/*`（layout=settings；默认→ `usage`，`hideUsagePage` 时→ `personal`）
- Nomops：`/settings`（`views/SettingsView.vue`，**3537 行单文件 + 内部 Tab**）+ `components/shell/SettingsMenu.vue`
- 截图：`screenshots/n8n/settings-*.png`（14 张）；`screenshots/nomops/settings.png`

## A. 设置壳（左侧菜单）—— 逐项对齐 ✅
| n8n 菜单项 | Nomops 菜单项 | 差异 |
|---|---|---|
| Usage and plan | Usage and plan | 一致 |
| Personal | Personal | 一致 |
| Users | Users | 一致 |
| Roles `New` | Roles `New` | 一致 |
| n8n API | **nomops API** | 品牌替换（正确，红线：禁 n8n 字样） |
| External Secrets | External Secrets | 一致 |
| Environments | Environments | 一致 |
| SSO | SSO | 一致 |
| Security & policies | Security & policies | 一致 |
| LDAP | LDAP | 一致 |
| Log Streaming | Log Streaming | 一致 |
| OpenTelemetry | OpenTelemetry | 一致 |
| Community nodes | Community nodes | 一致 |
| Instance-level MCP `Preview` | Instance-level MCP `Preview` | 一致 |
| Chat `Preview` | Chat `Preview` | 一致 |
| Version 2.30.4 | Version 0.9.0 | 版本号（各自实例，合理） |

> 菜单顺序与徽章（`New`/`Preview`）**完全对齐**。返回箭头 `← Settings` 一致。

## B. 各子页对照（14 子页已双侧截图并排 ✅）

> **重要背景**：本地 n8n 实例的 license 是**部分授权**——部分企业页已解锁（Variables 显示「Add first variable」），部分仍锁（**Log Streaming 显示 paywall「Available on the Enterprise plan / See plans」**）。因此有些页无法对 n8n 做「已解锁态」像素对比。两个产品的**特性门控地图本就不同**（Nomops 自有 license），门控差异属预期，非 bug。

### B1. 逐字段一致（近 1:1）✅
| 子页 | 对照结论 |
|---|---|
| **Personal** | 逐字段一致：Basic Info(First*/Last*/Email*) + Security(Change password / 2FA「currently disabled」+ Enable 2FA) + Personalisation(Theme=System default) + Save。右上用户 chip(名/Owner/头像)一致。 |
| **Users** | 一致：标题 + `2 users` + 搜索 + `Invite`(橙) + 表(User/Account Type/Last Active/2FA/Projects + 行`⋯`)。仅行`⋯`常显 vs n8n hover 显（细微）。 |
| **API** | 一致：空态虚线框 + 「Create API key」。 |
| **Community nodes** | 一致：空态「Supercharge your workflows with community nodes」+「Install a community node」（本实例未装包，n8n 实例装了 2 个显列表——皆各自数据态）。 |
| **Usage and plan** | IA 等价、内容自有：「Enterprise Edition」+ Published workflows `1 of Unlimited` + Enter activation key/Remove license/Manage plan + Upgrade to Pro(¥99/月,支付宝) + Admin 配额覆盖。合理差异。 |

### B2. Nomops 自有实现（结构性差异，多为自托管务实取舍）⚠️
| 子页 | n8n | Nomops 现状 | 差异性质 |
|---|---|---|---|
| **Environments** | Git 配置：Connection Type(SSH/HTTPS) + SSH Repository URL + **应用内 SSH Key(ED25519 + Refresh Key)** + Connect | Repository URL + Branch(main) + Connect；认证**委托宿主 Git 配置**(SSH deploy key/credential helper)，无应用内密钥管理 | **不一致（IA 简化）**——功能都能连 git，但 n8n 应用内管密钥、Nomops 靠宿主 |
| **Log Streaming** | 多 destination 类型(webhook/syslog/sentinel) + 卡片 + `EventDestinationSettingsModal` + 细粒度事件树（本实例被 license 锁，显 paywall） | 内联单表单：Name + Webhook URL + Signing secret(HMAC-SHA256) + Events(2 勾:Execution finished/Audit events) + Add destination | **不一致（简化）**——webhook-only，无 syslog/sentinel、无事件树、无 modal |
| **External Secrets** | 多 provider(Vault/AWS/Azure/GCP/Infisical) + 连接 modal | 单 provider「Environment variables」(`NOMOPS_SECRET_<KEY>` env)，只读展示(Provider/Status/Available secrets 名) | **不一致（简化）**——仅 env-var provider |

### B3. 待下一轮细看（已截图，未逐字段）
SSO / LDAP / Security & policies / OpenTelemetry / Roles(锁态) / MCP / Chat —— Nomops 侧截图已在 `screenshots/nomops/settings-*.png`，本轮未逐字段展开。

## C. 差异小结（进 gap-list）
- **壳层 + Personal/Users/API/Community：完全对齐** ✅。
- **Environments / Log Streaming / External Secrets：Nomops 自有简化实现** —— 结构性差异（P2，多属自托管设计取舍，非必改；若要 100% 对齐 IA 则列改造项）。
- **特性门控地图差异**（Variables/Log Streaming 两侧解锁状态相反）：各产品自有 license，预期差异；唯一内部矛盾是 Variables（见 `overview-workflows.md` P1-2）。
- **修正**：原 gap `P2-2 凭证字段缺 Fixed/Expression` 需收窄——Nomops **节点参数有** Fixed/Expression 分段控件(`ParamInput.vue`)，仅**凭证 modal 自渲染字段**未接该控件（见 `credentials.md` 修正）。
