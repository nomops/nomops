# 00 · n8n 页面总清单（审计基线）

> 本文件是 n8n → Nomops UI/功能对齐审计的**总索引**。
> - 基线来源（只读参考）：`/Users/guowangkun/ByteMono/n8n`，源码版本 **2.31.0**；本地运行实例 **2.30.4**（Docker，`localhost:5678`，owner=`guowangkun@outlook.com`）。
> - 路由取自 `packages/frontend/editor-ui/src/app/router.ts` + `features/collaboration/projects/projects.routes.ts` + 各 `features/*/module.descriptor.ts` 动态注册。
> - 弹窗取自 `packages/frontend/editor-ui/src/app/components/Modals.vue`（静态注册表）+ `DynamicModalLoader`（模块动态弹窗）。
> - 截图证据：`docs/ui-audit/screenshots/n8n/*.png`（Playwright 无头 + 注入 owner 会话，1440×900，light 主题）。
> - **红线**：源码仅用于确认交互逻辑/状态机/校验规则，Nomops 一律用自有组件库 + design-tokens 重写；对齐信息架构与交互行为，不对齐像素配色。

---

## A. 顶层信息架构（左侧全局导航 Rail）

运行实例左侧竖排图标 rail（自上而下）：
`+ 新建` · `🔍 搜索(命令面板)` · `▣ 折叠侧栏` · `🏠 Home(Overview)` · `👤 Users/账户` · `💬 Chat` … 底部：`📦 Templates` · `📊 Insights` · `❓ 帮助(有红点)` · `⚙ Settings`。

Home（Overview）主区是 **单页 + 顶部 Tab** 结构：Workflows / Credentials / Executions / Variables / Data tables，上方固定 5 张 KPI 卡（Prod. executions / Failed prod. executions / Failure rate / Time saved / Run time avg）。

---

## B. 路由总表

图例：权限 `middleware`（authenticated=登录, guest=未登录, rbac=作用域, enterprise=企业版, custom=特性开关, defaultUser=首启）。版本：**社区**=开源默认可见 / **企业**=需 License / **模块**=模块开关注册。

### B1. 认证 / 引导（layout=auth，未登录可达）

| 路由 | VIEWS | 组件 | 权限 | 版本 |
|---|---|---|---|---|
| `/signin` | SIGNIN | SigninView | guest | 社区 |
| `/signup` | SIGNUP | SignupView | guest | 社区（邀请） |
| `/signout` | SIGNOUT | SignoutView | authenticated | 社区 |
| `/setup` | SETUP | SetupView | defaultUser | 社区（首个 owner） |
| `/forgot-password` | FORGOT_PASSWORD | ForgotMyPasswordView | guest | 社区 |
| `/change-password` | CHANGE_PASSWORD | ChangePasswordView | guest | 社区 |
| `/saml/onboarding` | SAML_ONBOARDING | SamlOnboarding | authenticated+custom | 企业(SAML) |
| `/oauth/consent` | OAUTH_CONSENT | OAuthConsentView | authenticated | 社区 |

### B2. 首页 / 项目 / 共享（Overview 家族）

| 路由 | VIEWS | 组件 | 权限 | 版本 |
|---|---|---|---|---|
| `/` | — | 空 stub→重定向 | authenticated | 有 instance-ai 时进 `/assistant`，否则 `/home/workflows` |
| `/home` → `/home/workflows` | HOMEPAGE | — | authenticated | 社区（chat 用户被踢去 `/home/chat`） |
| `/home/workflows` | WORKFLOWS | WorkflowsView | authenticated | 社区 |
| `/home/credentials/:credentialId?` | CREDENTIALS | CredentialsView | authenticated | 社区 |
| `/home/executions` | EXECUTIONS | ExecutionsView | authenticated | 社区 |
| `/home/folders/:folderId?/workflows` | FOLDERS | WorkflowsView | authenticated | 社区 |
| `/home/variables` | HOME_VARIABLES | ProjectVariables | authenticated | 社区(读)/企业(写) |
| `/home/datatables` | DATA_TABLE_VIEW | (module) | authenticated+custom | 模块 Data Table |
| `/home/chat` `…/:id` `…/workflow-agents` `…/personal-agents` | CHAT_VIEW 等 | (module) | authenticated | 模块 Chat |
| `/home/agents` | AGENTS_LIST_VIEW | (module) | authenticated+custom | 模块 Agents |
| `/projects/:projectId/{workflows,credentials,executions,folders,variables}` | PROJECTS_* | 同上组件 | authenticated+custom | 社区/企业(多项目) |
| `/projects/:projectId/settings` | PROJECT_SETTINGS | ProjectSettings | authenticated+custom | 企业(项目) |
| `/projects/:projectId/agents…` `…/datatables…` | PROJECT_AGENTS 等 | (module) | authenticated+custom | 模块 |
| `/shared/workflows` | SHARED_WORKFLOWS | WorkflowsView | authenticated+custom | 企业(共享) |
| `/shared/credentials/:credentialId?` | SHARED_CREDENTIALS | CredentialsView | authenticated+custom | 企业(共享) |
| `/workflows` `/credentials` `/executions` `/variables` | — | 重定向 → `/home/*` | — | 旧路径兼容 |

### B3. 工作流编辑器 & 执行（layout=workflow）

| 路由 | VIEWS | 组件 | 权限 | 版本 |
|---|---|---|---|---|
| `/workflow/new` | NEW_WORKFLOW | NodeView | authenticated | 社区（生成 nanoid 后跳 `/workflow/:id?new=true`） |
| `/workflow/:workflowId/:nodeId?` | WORKFLOW | NodeView | authenticated | 社区（**画布主页 + NDV**） |
| `/workflow/:workflowId/executions` | WORKFLOW_EXECUTIONS | WorkflowExecutionsView | authenticated | 社区 |
| ↳ `` (default) | EXECUTION_HOME | WorkflowExecutionsLandingPage | authenticated | 社区（空态落地） |
| ↳ `:executionId/:nodeId?` | EXECUTION_PREVIEW | WorkflowExecutionsPreview | authenticated | 社区（执行详情预览） |
| `/workflow/:workflowId/debug/:executionId` | EXECUTION_DEBUG | NodeView | authenticated+enterprise | 企业(DebugInEditor) |
| `/workflow/:workflowId/evaluation` `…/test-runs/:runId` `…/collections/:cid/compare` | EVALUATION* | Evaluation views | authenticated | 企业(评测) |
| `/workflow/:workflowId/history/:versionId?` | WORKFLOW_HISTORY | WorkflowHistory | authenticated | 企业(版本历史) |
| `/workflows/templates/:id` | TEMPLATE_IMPORT | NodeView | authenticated | 社区 |
| `/workflows/onboarding/:id` | WORKFLOW_ONBOARDING | WorkflowOnboardingView | authenticated | 社区 |
| `/workflows/demo` `…/demo/diff` | DEMO / DEMO_DIFF | NodeView / DemoDiffView | authenticated(bypass 预览) | 社区 |

### B4. 模板 / 集合 / Insights / AI 助手

| 路由 | VIEWS | 组件 | 权限 | 版本 |
|---|---|---|---|---|
| `/templates/` | TEMPLATES | TemplatesSearchView | authenticated+templatesEnabled | 社区（无自定义 host 时跳外站） |
| `/templates/:id` | TEMPLATE | TemplatesWorkflowView | 同上 | 社区 |
| `/templates/:id/setup` | TEMPLATE_SETUP | SetupWorkflowFromTemplateView | 同上 | 社区（实验分流到 IMPORT） |
| `/collections/:id` | COLLECTION | TemplatesCollectionView | 同上 | 社区 |
| `/insights/:insightType?` | INSIGHTS | (module) | authenticated+rbac | 模块 Insights（企业解锁全维） |
| `/assistant` `…/new` `…/:threadId` | INSTANCE_AI_* | (module) | authenticated+custom | 模块 instance-ai |
| `/instance-ai` `…/:threadId` | → INSTANCE_AI_* | 重定向 | — | 兼容 |
| `/resource-center` | RESOURCE_CENTER | ResourceCenterView | authenticated + PostHog 实验 | 实验 |

### B5. 设置（`/settings`，layout=settings；默认→ usage，hideUsagePage 时→ personal）

| 子路由 | VIEWS | 组件 | 权限 scope | 版本 |
|---|---|---|---|---|
| `usage` | USAGE | SettingsUsageAndPlan | custom(!hideUsagePage) | 社区 |
| `personal` | PERSONAL_SETTINGS | SettingsPersonalView | authenticated | 社区 |
| `users` | USERS_SETTINGS | SettingsUsersView | `user:create`/`user:update` | 社区 |
| `roles` | ROLES_SETTINGS | RolesView | `role:manage`/`role:manageProject` | 社区(读)/企业(自定义角色) |
| `project-roles/*` `instance-roles/*` | *_ROLE_* | Role views | rbac+enterprise(CustomRoles) | 企业 |
| `api` | API_SETTINGS | SettingsApiView | `apiKey:list` | 社区 |
| `external-secrets` | EXTERNAL_SECRETS_SETTINGS | SettingsExternalSecrets / SecretsProviders | `externalSecretsProvider:*` | 企业 |
| `environments` | SOURCE_CONTROL | SettingsSourceControl | `sourceControl:manage` | 企业(Git) |
| `sso` | SSO_SETTINGS | SettingsSso | `saml:manage` | 企业(SAML/OIDC) |
| `ldap` | LDAP_SETTINGS | SettingsLdapView | `ldap:manage` | 企业 |
| `log-streaming` | LOG_STREAMING_SETTINGS | SettingsLogStreamingView | `logStreaming:manage` | 企业 |
| `security` | SECURITY_SETTINGS | SecuritySettings | `securitySettings:manage` | 企业(安全策略) |
| `encryption-keys` | ENCRYPTION_KEYS_SETTINGS | SettingsEncryptionKeys | `encryptionKey:manage`+ENV flag | 企业 |
| `community-nodes` | COMMUNITY_NODES | SettingsCommunityNodesView | `communityPackage:*`+custom | 社区 |
| `workers` | WORKER_VIEW | WorkerView | `workersView:manage` | 企业(队列) |
| `ai` | AI_SETTINGS | SettingsAIView | `aiAssistant:manage`+custom | 企业(AI 助手) |
| `n8n-connect` | AI_GATEWAY_SETTINGS | SettingsAiGatewayView | custom(AiGatewayEnabled) | 云/企业 |
| `resolvers` | RESOLVERS | ResolversView | `credentialResolver:*`+custom | 企业(动态凭证) |
| `migration-report/*` | MIGRATION_REPORT* | Migration views | `breakingChanges:list` | 社区（升级报告） |
| `opentelemetry` | OPENTELEMETRY_SETTINGS | (module) | rbac+custom | 模块 OTel |
| `mcp` | MCP_SETTINGS_VIEW | (module) | authenticated+custom | 模块 MCP（Preview） |
| `chat` | CHAT_SETTINGS_VIEW | (module) | rbac | 模块 Chat（Preview） |
| `assistant`/`instance-ai` | INSTANCE_AI_SETTINGS_VIEW | (module) | rbac+custom | 模块 instance-ai |
| `agent-builder` | AGENT_BUILDER_SETTINGS_VIEW | (module) | rbac | 模块 Agents |

> 实例侧栏实测可见的设置项（owner + 本地 license）：Usage and plan · Personal · Users · Roles`New` · n8n API · External Secrets · Environments · SSO · Security & policies · LDAP · Log Streaming · OpenTelemetry · Community nodes · Instance-level MCP`Preview` · Chat`Preview`。

### B6. 错误 / 兜底

| 路由 | VIEWS | 组件 |
|---|---|---|
| `/entity-not-found/:entityType` | ENTITY_NOT_FOUND | EntityNotFound |
| `/entity-not-authorized/:entityType` | ENTITY_UNAUTHORIZED | EntityUnAuthorised |
| `/:pathMatch(.*)*` | NOT_FOUND | ErrorView（404） |

---

## C. 弹窗（Modal）注册表

来源 `Modals.vue` 的 `ModalRoot`（静态，约 60 个）+ `DynamicModalLoader`（模块动态）。按归属页分组：

### C1. 工作流 / 画布 / 节点
- `DUPLICATE_MODAL_KEY` 复制工作流 · `IMPORT_WORKFLOW_URL_MODAL_KEY` 从 URL 导入 · `IMPORT_CURL_MODAL_KEY` cURL 导入
- `WORKFLOW_SETTINGS_MODAL_KEY` 工作流设置 · `WORKFLOW_SHARE_MODAL_KEY` 共享(企业) · `TAGS_MANAGER_MODAL_KEY` 标签管理
- `WORKFLOW_ACTIVE_MODAL_KEY` 激活成功 · `WORKFLOW_ACTIVATION_CONFLICTING_WEBHOOK_MODAL_KEY` webhook 冲突
- `WORKFLOW_DIFF_MODAL_KEY` 差异对比 · `WORKFLOW_EXTRACTION_NAME_MODAL_KEY` 子工作流抽取命名
- `WORKFLOW_DESCRIPTION_MODAL_KEY` 描述 · `WORKFLOW_PUBLISH_MODAL_KEY` 发布 · `FROM_AI_PARAMETERS_MODAL_KEY` fromAI 参数
- `CHAT_EMBED_MODAL_KEY` 内嵌聊天 · `BINARY_DATA_VIEW_MODAL_KEY` 二进制数据查看

### C2. 版本历史（企业）
- `WORKFLOW_HISTORY_VERSION_RESTORE` 恢复 · `WORKFLOW_HISTORY_VERSION_UNPUBLISH` 取消发布 · `WORKFLOW_HISTORY_NAME_VERSION_MODAL_KEY` / `WORKFLOW_HISTORY_PUBLISH_MODAL_KEY` 版本命名/发布

### C3. 凭证
- `CREDENTIAL_EDIT_MODAL_KEY` 新建/编辑凭证 · `CREDENTIAL_SELECT_MODAL_KEY` 选择凭证类型 · `CREDENTIAL_RESOLVER_EDIT_MODAL_KEY` 动态凭证解析器 · `SETUP_CREDENTIALS_MODAL_KEY` 模板凭证向导

### C4. 执行
- `DEBUG_PAYWALL_MODAL_KEY` 调试付费墙 · `STOP_MANY_EXECUTIONS_MODAL_KEY` 批量停止 · `ADD_EXECUTION_TO_DATASET_MODAL_KEY` 加入评测数据集

### C5. 设置 / 账户 / 用户
- `CHANGE_PASSWORD_MODAL_KEY` / `CONFIRM_PASSWORD_MODAL_KEY` 改/确认密码 · `MFA_SETUP_MODAL_KEY` / `PROMPT_MFA_CODE_MODAL_KEY` 2FA
- `INVITE_USER_MODAL_KEY` 邀请 · `DELETE_USER_MODAL_KEY` 删除用户 · `PERSONALIZATION_MODAL_KEY` 个性化问卷
- `API_KEY_CREATE_OR_EDIT_MODAL_KEY` API Key · `ABOUT_MODAL_KEY` 关于 · `VERSIONS_MODAL_KEY`(UpdatesPanel) 版本更新 · `WHATS_NEW_MODAL_KEY` 新特性 · `NPS_SURVEY_MODAL_KEY` NPS

### C6. 集成（企业 .ee）
- 外部密钥：`EXTERNAL_SECRETS_PROVIDER_MODAL_KEY` / `SECRETS_PROVIDER_CONNECTION_MODAL_KEY` / `DELETE_SECRETS_PROVIDER_MODAL_KEY`
- Source Control：`SOURCE_CONTROL_PUSH_MODAL_KEY` / `SOURCE_CONTROL_PULL_MODAL_KEY` / `SOURCE_CONTROL_PULL_RESULT_MODAL_KEY`
- 日志流：`LOG_STREAM_MODAL_KEY` · 社区节点：`COMMUNITY_PACKAGE_INSTALL_MODAL_KEY` / `COMMUNITY_PACKAGE_CONFIRM_MODAL_KEY` · Usage：`COMMUNITY_PLUS_ENROLLMENT_MODAL`

### C7. 文件夹 / 项目 / 变量
- `DELETE_FOLDER_MODAL_KEY` / `MOVE_FOLDER_MODAL_KEY` · `PROJECT_MOVE_RESOURCE_MODAL` · `VARIABLE_MODAL_KEY` 变量新建/编辑

### C8. AI（助手 / Agent / 网关）
- `NEW_ASSISTANT_SESSION_MODAL` · `AI_BUILDER_DIFF_MODAL_KEY` · `AGENT_CONFIRMATION_MODAL_KEY` · `INSTANCE_AI_CREDENTIAL_SETUP_MODAL_KEY` · `INSTANCE_AI_TOOLS_CONNECTION_MODAL_KEY` · `AI_GATEWAY_TOP_UP_MODAL_KEY`

### C9. 实验
- `EXPERIMENT_TEMPLATE_RECO_V2_KEY` / `EXPERIMENT_TEMPLATE_RECO_V3_KEY` 节点推荐

### C10. 全局非 Modal 浮层（另计，见分页文档）
命令面板（⌘K CommandBar）· 通知 toast · 用户菜单 · 版本更新红点 · Ask AI 侧栏 · NDV（节点详情，抽屉而非 modal）· LogsPanel（画布底部 Chat/Logs）。

---

## D. 页面清单汇总（路由 | 页面名 | 弹窗数 | 子页/Tab | 版本）

| 路由组 | 页面名 | 关联弹窗 | 子页/Tab | 版本 |
|---|---|---|---|---|
| `/home/*` | Overview（工作流/凭证/执行/变量/数据表） | ~10 | 5 Tab | 社区 |
| `/workflow/:id` | 工作流编辑器（画布+NDV+Logs） | ~15 | Editor/Executions/Evaluations | 社区 |
| `/workflow/:id/executions` | 工作流执行列表+详情 | 3 | 列表/详情 | 社区 |
| `/workflow/:id/history` | 版本历史 | 4 | — | 企业 |
| `/home/credentials` | 凭证列表 | 4 | — | 社区 |
| `/home/executions` | 全局执行列表 | 3 | — | 社区 |
| `/home/variables` | 变量 | 1 | — | 社区/企业 |
| `/home/datatables` | 数据表 | — | 列表/详情 | 模块 |
| `/home/chat` | Chat（AI 会话） | 1 | 会话/agents | 模块 |
| `/insights` | Insights 仪表盘 | — | 按类型 Tab | 模块/企业 |
| `/templates` | 模板市场 | — | 搜索/详情/集合 | 社区 |
| `/projects/:id/*` | 项目空间 | ~8 | 同 Overview + settings | 企业 |
| `/shared/*` | 共享给我 | — | 工作流/凭证 | 企业 |
| `/settings/*` | 设置（24 子页） | ~15 | 见 B5 | 社区+企业+模块 |
| `/signin` 等 | 认证 | — | — | 社区 |

---

## E. 审计进度追踪

阶段二逐页深度审计（`pages/<route>.md`）状态：

| 页面文档 | 状态 |
|---|---|
| `pages/canvas-editor.md`（画布编辑器 P0） | ✅ 完成 |
| `pages/executions.md`（执行列表+详情 P0） | ✅ 完成 |
| `pages/credentials.md`（凭证 P0） | ✅ 完成 |
| `pages/overview-workflows.md`（工作流列表 P1） | ✅ 完成 |
| `pages/settings-shell.md`（设置壳 + 各子页 P1） | ✅ 完成 |
| `pages/secondary-pages.md`（Chat/Templates/Projects/Insights/版本历史/认证/命令面板/Admin/Audit） | ✅ 完成（C 轮） |
| Evaluations（社区锁态）/ Data table 详情 / 认证 SSO 入口 / Admin·Audit 字段级 | ⏳ 剩余细项 |

阶段四差异清单：`90-gap-list.md`（已含误报撤销 + 已修记录 + C 轮新增 C-1）。
