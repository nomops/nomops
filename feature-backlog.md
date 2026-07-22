# nomops 功能开发待办清单（feature-backlog）

> 来源：2026-07-21 全项目缺口盘点（引擎/服务端/节点/前端四路代码审计 + diff-ledger + ui-audit gap-list 交叉）；2026-07-22 增补 P8-P10（自托管 n8n 库 110 表逐一对照，#34-47）；2026-07-22 增补 P11（n8n 2.30.4 节点面板全目录 `/types/nodes.json` 对照，Core Node 缺口 34 个 → #48-54，详见 `docs/node-catalog-gap.md`）。
> 用法：按编号发布指令逐项开发；完成后在本文件勾选并记 commit。
> 工作量：S=半天内 · M=1-2 天 · L=3 天+ · XL=独立立项。

---

## P0 · bug 修复与日常使用痛点（小而立竿见影）

- [x] **1. 浅色主题切换器修复** `S` ✅ 2026-07-21（lib/theme.ts + main.ts 启动引导；live 四态截图验证）
  真 bug：471 项浅色令牌完整，但 `applyTheme()` 把 `data-theme` 写到 `<html>`，令牌全键在 `body[data-theme]`；且 `main.ts` 启动不读 `nomops.theme` 偏好。选 Light theme 视觉无变化。
  → 改写目标元素 + 启动引导读偏好 + 移除 index.html 硬编码 dark 或与偏好合并。
  证据：`SettingsView.vue:449-451`、`main.ts`、`index.html:9`。

- [x] **2. 执行取消/停止** `M` ✅ 2026-07-21（stop API + 注册表 cancel + worker 看门狗 + 画布双态按钮/详情头/行菜单/批量停止;4 server 测;live API+UI 双验证）
  引擎 `WorkflowExecute.cancel()` 已有，但无任何 API 端点能停掉运行中的执行。
  → 后端 stop 端点（含 queue mode 下的 worker 侧中断）+ 前端执行列表/详情停止按钮 + 批量停止条（ui-audit 遗留项）。

- [x] **3. 画布复制粘贴 + 快捷键** `M` ✅ 2026-07-21（store copyPayload/pasteNodes/removeNodes + ⌘A/⌘C/⌘V 绑定;Delete 经查 VueFlow delete-key-code 原已通,升级为单步撤销;8 store 测;live ⌘A→⌘C→⌘V 全链路验证）

- [x] **4. 节点悬浮菜单补齐** `S` ✅ 2026-07-21（⋯ 菜单补 Rename + Pin/Unpin,无运行数据置灰;live 验证菜单/角标/改名连接重写;Replace/Convert-to-subworkflow 仍未实现→并入 #33 后续裁决）

## P1 · 节点库扩充（工作流表达力短板，最大空白）

- [x] **5. 数据处理节点五件套：Switch / Filter / SplitOut / Aggregate / Loop** `L` ✅ 2026-07-21（共享条件库 + outputNames 契约(顺手清掉前端 If 特判) + 引擎 contextData/getContext(Loop 地基,随状态序列化);14 nodes 测 + 1 core 测 + 1 server 引擎全链路测;live 画布标签/面板搜索验证）

- [x] **6. 触发配套三节点：Error Trigger / Execute Workflow Trigger / RespondToWebhook** `M` ✅ 2026-07-21（错误流/子流优先专用起点;webhook 自定义响应经 helpers.setWebhookResponse 回调线程,队列模式退默认摘要;7 server 测;live webhook 201 自定义 body 验证）

- [x] **7. Google Sheets + Telegram 集成节点** `M` ✅ 2026-07-21（credentialInjection 加 path 注入(URL 占位符)+HTTP 错误里注入值打码(铁律 3);Telegram sendMessage/getMe、Sheets getValues/appendRow(OAuth2 Bearer access_token);2 core 测+结构守卫扩 path 校验;dev 实例 node-types 34 个含两新节点）

## P2 · 现成后端的前端拆墙 / 接线

- [x] **8. Insights 拆锁墙** `S/M` ✅ 2026-07-22（真数据页:KPI 五卡+路由 metric 高亮+5 档范围选择+SVG 成功/失败堆叠趋势(粒度跟后端 hour/day);live 造数截图验证。D153 项目选择器需后端跨项目聚合,单列不做）

- [x] **9. 设置页本地态字段接线** `M` ✅ 2026-07-22（OIDC prompt/acr_values/追加 scopes 进授权跳转;LDAP 7 字段贯通(userFilter/证书豁免真进 ldapts)+同步 preview/run 真实现(dry-run 对账+JIT 预配/改名,幂等);MCP redirect 清单持久化+清洗;4 server 测+live 往返/截图。残余:同步定时开关仍本地态(无调度器不做假)）

- [x] **10. 执行批量删除** `S` ✅ 2026-07-22（POST /api/executions/delete ≤500/批,归属外静默跳过+audit;前端多选浮条改单请求;1 server 测;live deleted:2 验证）

- [x] **11. 台账遗留 UI 小项清扫** `S` ✅ 2026-07-22（D026 面板 "Workflow · 名" 徽标(改名实时跟随);D114 options 自定义下拉(描述副行/键盘导航/点击外关闭);panel-right→Focus Panel 钉参联动;D143 弹层 Configuration JSON+复制;D144 描述铅笔编辑(新 admin 端点 unscoped 仅 description);2 前端测+1 server 测;live 三项截图验证）

## P3 · 协作与归属（表结构已就绪）

- [x] **12. 工作流/凭证共享（sharing）** `L` ✅ 2026-07-22（复用归属 join:共享=插非 owner 行;workflow:editor=读/跑/改、credential:user=仅执行注入;删/改秘密/管共享面恒 owner 专属;实现进 ee/sharing-service(边界铁律);★修 getOwnerProjectId 多行不确定性;前端 Share 弹窗/凭证 Sharing tab/SharedView 真数据;4 server 测;dev license 重签含 sharing,live UI 全流程验证）

- [x] **13. 工作流移动/转移** `M` ✅ 2026-07-22（卡片菜单 Move 复活(基线第 7 项)→弹窗双区:文件夹移动(死代码复用)+跨项目转移;transfer 端点 owner 专属+目标 editor+ 校验,共享行清空/文件夹归零,凭证不随迁(确认时明示);1 server 测;live 弹窗+转移+X-Project-Id 上下文验证）

- [x] **14. Chat 会话与个人 Agent 落后端** `M` ✅ 2026-07-22（chat_sessions/chat_agents 双方言表(迁移 0023,messages JSON 随行);用户维度 CRUD+PUT 幂等 upsert(setWhere 归属护栏,他人 uuid 403);前端换 API 持久化+旧 localStorage 一次性迁移(短 id→uuid);2 server 测;live 建会话/Agent→刷新后端回载验证）

## P4 · 触发器与凭证深化

- [x] **15. 匿名 resume webhook（waiting webhook）** `M` ✅ 2026-07-22（resumeToken 随执行状态落库;表达式新增 $execution.id/resumeUrl(任意节点参数可把恢复 URL 发出去);公开 /webhook-waiting/:id/:token 常数时间比较,不匹配一律 404;1 server 全链路测）

- [x] **16. OAuth2 refresh token 自动续期** `S/M` ✅ 2026-07-22（refreshIfNeeded:过期/临期 60s+有 refresh_token → 刷新存回,支持轮换;执行注入前经 setter 注入的 refresher 兜一手;连带修注入视图 oauthTokenData 摊平(声明式 Bearer {{access_token}} 原本读不到);2 server 测(demo provider 真 HTTP)）

- [x] **17. 重试从失败节点续跑** `M` ✅ 2026-07-22（复用 buildPartialRunState:失败节点标脏(闭包含下游),成功上游 runData 原样保留不重放触发;去掉 destination 止步续跑到底;定位失败/前置不足时优雅退回全量;1 server 测(时间戳证上游未重跑+删节点回退)）

- [x] **18. SMTP 邮件投递** `M` ✅ 2026-07-22（零依赖手搓 SMTP 客户端(EHLO/STARTTLS 升级/AUTH LOGIN/dot-stuffing/多行应答,同 metrics·TOTP 取舍);NOMOPS_SMTP_* 环境变量,未配置 NullMailer 保持日志回退;重置/邀请两流接线(fire-and-forget 不给枚举面);4 server 测(假 SMTP 服务器全协议+记录桩接线)）

## P5 · 引擎/表达式深化

- [x] **19. $fromAI + NDV「From AI」控件（D096）** `L` ✅ 2026-07-22（表达式 $fromAI(name,desc,type):collect 模式登记参数拼工具 JSON schema、provided 模式用模型实参解析、AI 上下文外安全降级 undefined;from-ai.ts collectFromAiParams/fromAiSchema/resolveWithAiArgs;ISupplyDataContext 加 getRawNodeParameter(拿未求值原始值);HttpTool 支持 url/query/body 里 $fromAI(schema 从声明拼、invoke 用实参解析、无声明退回旧 input);NDV AI 工具字段显 ✨From AI 芯片插模板;workflow 24+nodes 51+frontend 78 测;live 芯片渲染+插入截图验证）

- [x] **20. 表达式访问增强：$node 高级访问 / $input / $runIndex / $prevNode** `M` ✅ 2026-07-22（$('X')/$node[] 返回访问器 .json/.first/.last/.all/.itemMatching/.item;$input.first/last/all/item/length;$runIndex/$prevNode;引擎传 runIndex(runData 长度)+prevNode(exec.source);8 表达式测+1 引擎集成测）

- [x] **21. pairedItem 跨节点血缘解析** `M/L` ✅ 2026-07-22（expression/paired-item.ts:pairedItem+source 双向回溯 traceLineage/itemInAncestor;$('X').item 按血缘定位当前 item 在祖先节点的来源(非永远首 item);断链回退首 item 不硬崩;引擎集成测:反序节点后 $('A').item 正确交叉取 a1/a0）

- [x] **22. binary 数据生命周期** `M` ✅ 2026-07-22（IBinaryDataStore 加 delete/list(三后端:FS/内存/S3 ListObjectsV2 翻页);collectBinaryIds 深扫执行数据引用;ExecutionRepository.setBeforeDelete 钩子——单删/批删/pruner/save-policy drop 四路删除都级联清 binary;sweepOrphanBinaries(store∖执行引用)进 pruner 同周期同 leader;store-contract delete/list 契约测+collectBinaryIds 单测+server 级联/孤儿 GC 端到端测）

## P6 · 平台能力面扩展

- [x] **23. External Secrets 多 provider** `L` ✅ 2026-07-22（Vault KV v2 provider:内存快照+后台刷新保同步 get()接口,零依赖 fetch;secretsProviderFromEnv 按 NOMOPS_SECRETS_PROVIDER 选;首刷失败不阻断启动;4 server 测(快照/mount-path/首刷失败/factory)+前端 provider 说明动态化。AWS/Azure/GCP 同抽象后续按需）
- [x] **24. Log Streaming 多 destination** `L` ✅ 2026-07-22（syslog destination:RFC 5424 over UDP/TCP,零依赖 dgram/net,SyslogFn 可注入测;细粒度事件树:订阅 execution 收全部子类型、execution.error 只收失败(effectiveType 按 status 派生+层级匹配);前端 kind 选择器+5 档事件勾选+动态 URL 提示;老数据无 kind 回退 webhook;2 新 server 测(syslog 送达+错误订阅只收失败)+前端 typecheck/build 过）
- [ ] **25. MCP OAuth 鉴权** `M/L`（现仅 access token；前端分段控件已画好）
- [ ] **26. Public API 独立面 + 细粒度 scopes** `L`（现 readonly/all 两档、复用内部 /api；API key Custom scopes 前端已画、提交降级 all）
- [ ] **27. OpenTelemetry 后端** `L`（现为零，前端整页本地态假表单；OTLP 导出 + 表单接线）
- [ ] **28. SCIM Groups** `M`（Users 已实现；Groups→projects 映射按 docs/07 延后项）
- [ ] **29. 自定义角色（custom roles）** `L`（现固定枚举；Roles 页锁卡）
- [x] **30. lastActive 字段（D146）** `S` ✅ 2026-07-22（users.last_active_at 双方言列(迁移 0024);touchLastActive 进程内 60s 节流打点,鉴权中间件 fire-and-forget 调用;instance/users 暴露给 admin;前端 Users 表 Last Active 列相对时间(Never/Xm/Xh/Xd/日期);3 server 测(打点/节流/pending null)）

## P7 · Epic 级（独立立项，先规划再动工）

- [ ] **31. EPIC-EVAL 评测/测试子系统** `XL`
  dataset / eval trigger / test run / metric / 执行标注👍👎 / Debug in editor 全链，nomops 零后端。
- [ ] **32. Chat 多模态（附件）+ 语音 STT** `XL`
- [ ] **33. 凭证专属表达式模式** `M`（仅 `$secrets`/env 补全的专用控件，见 gap-list P2-4 收回记录）

## P8 · n8n 表对照补差 · 小而快 + 正确性（来源：2026-07-22 自托管 n8n 库对照盘点）

- [ ] **34. 每用户收藏（user_favorites）** `S`
  现 `workflows.favorite` 是全局布尔，多人项目里星标互相覆盖（语义错误）。
  → 新表 user_favorites(userId + resourceType/resourceId) + 迁移搬现有星标 + 星标/列表接口改按当前用户过滤。
  验收：双用户各自星标互不可见。

- [ ] **35. 执行标注 + 自定义元数据** `M`（执行标注从 #31 拆出先行，评测其余仍归 #31）
  n8n：execution_annotations(vote 👍👎 + note) + annotation_tag_entity(标注标签) + execution_metadata(运行中写 KV、列表可检索)。
  → 三表 + 执行详情标注 UI + 工作流内 customData 写入口 + 执行列表按标注/元数据过滤。
  验收：打分/笔记/标签往返；工作流写 customData 后列表能按键值筛出。

- [ ] **36. SSO 身份绑定表 + 同步历史** `M`（正确性隐患）
  现 OIDC/LDAP 靠 email JIT 匹配，email 变更或多 provider 并存会错认归属。
  → auth_identity(userId ↔ providerId/providerType)：登录时建绑定、此后优先按绑定匹配；auth_provider_sync_history 记每次 LDAP 同步的 scanned/created/updated/disabled 与错误。
  验收：改 email 后同一 LDAP 账号仍归同一 user；同步历史可查。

- [ ] **37. 登出令牌黑名单（invalid_auth_token）** `S`
  现登出仅客户端删 cookie，JWT 到期前仍有效。→ 落库黑名单 + 鉴权中间件查表 + 过期行清理。
  验收：登出后旧 token 立即 401。

## P9 · n8n 表对照补差 · 基础设施

- [ ] **38. DB 调度器（scheduled_job + scheduled_task）** `L`（地基项：解锁 #9 残余 LDAP 定时同步、#39 定时卷积、#44 Agent 定时任务）
  统一定时任务落库：cron/interval/一次性 fireAt + 时区 + nextRunAt + maxAttempts；触发实例租约抢占（claimedBy/leaseExpiresAt/leaseEpoch）。Schedule Trigger 迁移到其上，重启不丢、多实例不重复。
  验收：双实例并发同一 cron 只触发一次；重启后 nextRunAt 恢复继续。

- [ ] **39. Insights 预聚合管线** `M/L`（解锁 #8 遗留 D153 跨项目聚合；卷积任务依赖 #38）
  现从 executions 实时聚合，执行历史一清理数据即失。→ insights_raw(执行收尾写事件) → insights_by_period(hour/day 卷积) + insights_metadata(工作流/项目名快照)。
  验收：删执行后 Insights 数字不变；跨项目聚合视图可用。

- [ ] **40. 发布管线深化** `L`
  workflow_publish_history(发布/回滚事件史) + publication_outbox(发布↔触发器激活原子化、失败重放) + publication_trigger_status(逐触发器激活状态/错误) + workflow_dependency/credential_dependency(版本级子流/凭证引用索引)。
  验收：触发器激活失败在 UI 有状态与错误；发布史可回看；删被引用凭证前可见引用方。

- [ ] **41. Chat 工具体系** `M/L`（与 #32 多模态互补）
  chat_hub_tools(工具定义) + session_tools/agent_tools(会话级/Agent 级挂载)；消息带 workflowId/executionId 关联。
  验收：会话挂一个工作流工具 → 对话触发执行 → 消息里可跳执行详情。

- [ ] **42. SSO 角色映射规则（role_mapping_rule）** `M`（与 #28/#29 联动）
  按表达式把 SSO 声明/LDAP group 映射到角色与项目（role_mapping_rule + role_mapping_rule_project，order 定优先级）。
  验收：LDAP group → 项目成员自动生效。

- [ ] **43. 平台零散补差清扫** `S/M`
  folder_tag(文件夹打标)、mcp_registry_server(MCP registry 缓存)、instance_version_history(实例升级史)、users.settings(每用户偏好落库替 localStorage)。
  验收：逐项 live 验证。

## P10 · n8n 表对照 · Epic/远期（独立立项，先规划再动工）

- [ ] **44. EPIC-AGENTS Agents 平台** `XL`
  n8n 20 表体系：agent 定义/发布版本（agents + agent_history）、线程化执行 + token/成本核算（agent_execution*）、分层记忆（memory_entries + observations，embedding + 证据链）、定时任务（task_definition + run_lock，依赖 #38）、文件、外部渠道订阅（Telegram 等）。现仅 chat_agents 单表（name + system）。先出规划文档再动工。

- [ ] **45. EPIC-AI-BUILDER AI 生成工作流 + 实例助手** `XL`
  n8n 16 表体系：workflow_builder_session / ai_builder_temporary_workflow（AI 建流会话 + 临时流）、instance_ai_*（线程/检查点/运行树快照/HITL 待确认/观察-反思记忆/MCP 连接）。现 chat 的 wfSessionId 仅雏形。先出规划文档再动工。

- [ ] **46. 动态凭证（dynamic credentials）** `L/XL`（远期：Cloud 嵌入式/多租户场景才有价值，触发前不动工）
  dynamic_credential_resolver(解析器) + entry/user_entry(按 subject/user 的凭证值) + credentials.isResolvable/resolverId。运行时按租户解析凭证。

- [ ] **47. 实例信任密钥链** `M`（远期：deployment_key/trusted_key/trusted_key_source/token_exchange_jti；OIDC token exchange 与实例签名，待 Cloud 联邦需求触发）

## P11 · Core Node 补差（节点库骨架缺口，来源：2026-07-22 n8n 2.30.4 面板全目录对照）

> n8n 面板 Core Nodes 共 53 个，nomops 已覆盖 19（#5/#6 批次 + 基础节点），缺 34。这 34 个是任何工作流都可能用到的平台骨架，逐个对照见 `docs/node-catalog-gap.md`。按批次粒度拆为 #48-54，优先级由高到低。app 集成（355）与 AI/RAG（101）不在此节，走独立框架/排期。

- [ ] **48. 数据变换六件套：Sort / Limit / Remove Duplicates / Rename Keys / Summarize / Compare Datasets** `M/L`
  纯内存转换，引擎侧实现，零外部依赖——对标已完成的 #5 五件套，ROI 最高。
  → Sort（多字段排序/自定义比较）、Limit（截断 N 条）、Remove Duplicates（按字段去重，跨执行去重可后置）、Rename Keys（键改名/正则）、Summarize（分组聚合 sum/avg/count/concat）、Compare Datasets（双输入 diff：同/异/仅左/仅右四路输出，参照 Merge 的多输入契约）。
  验收：六节点各自单测；Compare Datasets 四路输出拓扑经引擎全链路测。

- [ ] **49. 日期/加密/文本格式五件套：Date & Time / Crypto / HTML / XML / Markdown** `M/L`
  带轻量 helper 库的转换节点。
  → Date & Time（解析/格式化/加减/时区，选无依赖或极轻日期库）、Crypto（hash/hmac/base64/uuid、对称加解密，复用现有加密工具）、HTML（CSS 选择器提取 + 文本转 HTML）、XML（解析↔构建，与 JSON 互转）、Markdown（md↔html 双向）。
  验收：五节点单测覆盖典型 in/out；时区与编码边界用例。

- [ ] **50. 文件 IO 六件套：Read/Write File / Extract from File / Convert to File / Compression / FTP / Edit Image** `L`
  依赖 #22 已建的 binary 数据生命周期（IBinaryDataStore）。
  → Read/Write Files from Disk（本地读写，路径白名单/沙箱约束）、Extract from File（csv/json/xlsx/pdf/text 解析出 items）、Convert to File（items→csv/json/xlsx/二进制）、Compression（zip/gzip 压缩解压）、FTP（上传/下载/列目录，凭证类型 ftp/sftp）、Edit Image（缩放/裁剪/水印，需图像库，最重可末位排期）。
  验收：二进制往返（写→读、items→file→extract 回环）经端到端测；binary 引用被 #22 的级联 GC 正确回收。

- [ ] **51. 远程执行 + 邮件三件套：SSH / Send Email / Email Trigger (IMAP)** `M/L`
  你现有的 Jira 只读运维 Agent 工作流就卡在 SSH 上跑不起来（见 docs/node-catalog-gap.md 用例）。
  → SSH（远程执行命令/传文件，凭证类型：密码 + 私钥，私钥解密后绝不落库/出日志——铁律 3）、Send Email（SMTP 发信节点，复用 #18 手搓的 SMTP 客户端，凭证走 smtp）、Email Trigger (IMAP)（轮询收件箱触发，依赖轮询触发地基 PollingTrigger）。
  验收：SSH 对本机容器执行命令回读 stdout；Send Email 经假 SMTP 服务器验证投递；IMAP 触发经轮询拉取新邮件启动执行。

- [ ] **52. 触发器补全五件套：Form Trigger / n8n Form / RSS Read / RSS Feed Trigger / SSE Trigger** `M`
  → Form Trigger（生成公开表单页，提交即触发，字段 schema 驱动）、n8n Form（流程内表单页，HITL 场景，多步表单）、RSS Read（拉取解析 feed 为 items）、RSS Feed Trigger（轮询 feed 新条目触发，依赖 PollingTrigger）、SSE Trigger（订阅 SSE 流触发）。命名遵循仓库铁律去 n8n 字样（Form Trigger / Form）。
  验收：Form Trigger 公开页提交→执行启动并带表单数据；RSS 轮询到新条目触发；SSE 收到事件触发。

- [ ] **53. 流程/工具杂项四件套：Stop and Error / Execution Data / TOTP / Git** `S/M`
  → Stop and Error（主动抛错终止执行，配合 Error Trigger #6）、Execution Data（读/写当前执行的元数据 KV，配合 #35 执行元数据）、TOTP（生成/校验 TOTP 验证码，复用已有 TOTP 实现）、Git（clone/commit/push 等，凭证走 SSH/token，最重可末位）。
  验收：Stop and Error 触发 Error Trigger 流；Execution Data 写入的 KV 在执行详情可见；TOTP 生成码与标准算法对齐。

- [ ] **54. 自引用/低价值节点（评估后按需，默认不做）** `S~M`
  n8n / n8n Trigger（调 n8n 自身 API / 监听实例事件——nomops 等价物应改造为「nomops 自 API 节点」+ 实例事件触发，价值取决于是否需要工作流操作平台自身）、Data table（n8n 的内置数据表功能，需整套 dataTable 后端，属独立特性非单节点）、AI Transform（自然语言生成转换代码，依赖 AI 建流能力 #45）、Track Time Saved（n8n 云运营指标，自托管无意义）。
  → 逐项在开发前单独裁决；Data table 若做应并入独立特性立项，AI Transform 挂靠 #45，Track Time Saved 直接不做。

---

## 不做 / 范围外（已裁决，勿重提）

- Desktop/Electron（已评估放弃）。
- B 类锁墙 6 项维持基线 1:1 阉割形态（Roles/Security & policies 等）——除非用户改裁决；Insights 例外已列 #8。
- Cloud 控制平面在独立仓库 `~/ByteMono/nomops-cloud`，不在本仓。
- Chat 附件/语音空按钮、凭证字段套用节点表达式控件（误导性假控件，见 gap-list）。
