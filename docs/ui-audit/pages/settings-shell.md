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
| **Environments** | Git 配置：Connection Type + 应用内 SSH Key + 分支下拉 + 选择性 Push/Pull + 同步工作流/变量/标签 | **✅ 已全量对齐（2026-07-21）**：Connection Type(SSH/HTTPS) + 应用内 ED25519 部署密钥(展示/Copy/Refresh) + 远端分支下拉/切换 + 选择性 Push 弹窗 + Pull 预览 + 同步 工作流/变量/标签 | **一致**（原判 P2-5"简化不动"经用户指正后提级重做，见 gap-list P2-5）|
| **Log Streaming** | 多 destination 类型(webhook/syslog/sentinel) + 卡片 + `EventDestinationSettingsModal` + 细粒度事件树（本实例被 license 锁，显 paywall） | **✅ 后续补齐**：webhook + RFC 5424 UDP/TCP syslog、测试投递、卡片管理和事件选择 | **已满足通用 destination 边界**；Sentinel 通过 syslog 接入，不新增厂商专用传输 |
| **External Secrets** | 多 provider(Vault/AWS/Azure/GCP/Infisical) + 连接 modal | **✅ 后续补齐**：env + HashiCorp Vault KV v2，统一 provider 抽象、快照和刷新 | **自托管主路径已完成**；其他云厂商按真实需求扩展 |

### B3. 历史待审范围
SSO / LDAP / Security & policies / OpenTelemetry / Roles / MCP / Chat 在本轮仅截图，后续功能已由 `feature-backlog.md` 对应项目持续交付；未逐字段取证不再自动记为 gap。

## C. 差异小结（进 gap-list）
- **壳层 + Personal/Users/API/Community：完全对齐** ✅。
- **Environments / Log Streaming / External Secrets：后续均已完成自托管可运营实现**；厂商专用适配不作为当前缺陷。
- **特性门控地图差异**（Variables/Log Streaming 两侧解锁状态相反）：各产品自有 license，预期差异；唯一内部矛盾是 Variables（见 `overview-workflows.md` P1-2）。
- **凭证表达式后续状态**：#33 已新增仅 `$secrets` 的凭证专属表达式控件，没有把节点 `$json`/item 上下文错误带入凭证。
