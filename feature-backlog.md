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
- [x] **25. MCP OAuth 鉴权** `M/L` ✅ 2026-07-22（OAuth 2.0 授权码+PKCE(S256):/.well-known/oauth-authorization-server 元数据发现+authorize(校验 MCP 启用+redirect 允许清单+铸授权码 10min TTL)+token(code_verifier PKCE 验证→access token 哈希+1h 过期存 settings);verifyBearer 同时认静态 token 与 OAuth token;授权码一次性;前端连接详情 OAuth 模式显发现 URL;6 server 测(元数据/全流程/redirect 拦截/PKCE 失败/method 校验)。无交互同意屏为 machine 流 honest 限制)
- [x] **26. Public API 独立面 + 细粒度 scopes** `L` ✅ 2026-07-22（auth/api-scopes.ts:resource:action 目录(workflow/execution/credential/variable/user/project ×read/write)+all/readonly 宏;中间件按 method+path 算所需 scope 强制;GET /api-keys/scopes 目录端点;/api/v1 版本化面(同处理器);前端 Custom 真勾选细粒度 scope(不再降级 all);4 server 测(细粒度/多scope/越资源/v1);api-keys.scope 存逗号列表)
- [x] **27. OpenTelemetry 后端** `L` ✅ 2026-07-22（otel-service:零依赖手搓 OTLP/HTTP(JSON) 导出器,执行收尾发 workflow.execute span(+includeNodeSpans 逐节点 child span,错误 status ERROR);config 存 settings+GET/PUT /api/otel(admin);抽样/禁用不发;execution-service 收尾旁路 exporter;前端 OTel 页 5 字段真接线(enabled/endpoint/tracePath/serviceName/sampleRate/nodeSpans);6 server 测。startupTimeout/traceparent/publishedOnly 仍 UI 态引擎未消费)
- [x] **28. SCIM Groups** `M` ✅ 2026-07-22（SCIM Group → team 项目,成员=project_relations(默认 project:editor);GET/POST/PUT/PATCH(add/remove/replace members + rename)/DELETE(空组删项目,持有资源 FK→409);displayName eq filter;toScimGroup 资源;ProjectRepository findAllByType/findByNameAndType/rename/deleteWithRelations;4 server 测(建组进 project_relations/PATCH 增删/PUT 替换/DELETE)）
- [x] **29. 自定义角色（custom roles）** `L` ✅ 2026-07-23（custom_roles 双方言表(迁移 0025)+CustomRoleRepository(缓存 list/scopesForName/CRUD);rbac.ts PROJECT_SCOPES 目录(workflow/execution/credential ×CRUD + member:manage)+tierForScopes 把 scope 集解析为有效内建层级(member:manage→owner、任意写/执行→editor、否则 viewer);中间件按角色名查 scopes→有效 tier 进 requireRole 门,未知角色降 viewer;/api/custom-roles CRUD(rbac 功能门+实例 admin,名字校验/内建重名 400/重复 409);成员指派接受自定义角色名(assertAssignableRole);Roles 页解锁真管理 UI(scope 分组勾选弹窗+表格增删改,未授权仍锁卡);8 server 测(scope 目录/非 admin 拦/只读→viewer 禁写/写 scope→editor 可建/无 scope 400/重名 400/重复 409/删除)+活体验证 create→list→delete 全通）
- [x] **30. lastActive 字段（D146）** `S` ✅ 2026-07-22（users.last_active_at 双方言列(迁移 0024);touchLastActive 进程内 60s 节流打点,鉴权中间件 fire-and-forget 调用;instance/users 暴露给 admin;前端 Users 表 Last Active 列相对时间(Never/Xm/Xh/Xd/日期);3 server 测(打点/节流/pending null)）

## P7 · Epic 级（独立立项，先规划再动工）

- [x] **31. EPIC-EVAL 评测/测试子系统** `XL` ✅ 2026-07-23（数据集复用 data_tables;test_runs+test_case_runs 双方言表(迁移 0026)+TestRunRepository;节点 evaluationTrigger(逐行 seed 注入)+evaluation(setMetrics/setOutputs→保留键 _nmMetrics/_nmOutputs,引擎零耦合);EvaluationService.createTestRun 逐行跑引擎·提取指标·按名求均值聚合·passed>=1 计通过;路由 POST/GET /workflows/:id/test-runs + GET/DELETE /test-runs/:id;前端画布评测 tab 解锁真管理面(数据集选择器+Run test+历史+聚合指标卡+逐用例表)+Debug in editor(把用例输入 pin 进 trigger 开编辑器);6 节点测+5 server 端到端测全绿;活体 Run test(Value 5.8/Passed 0.6)+Debug(pin 驱动执行)双验。执行标注👍👎已按 backlog 拆去 P8 #35）
- [x] **32. Chat 多模态（附件）+ 语音 STT** `XL` ✅ 2026-07-23（附件走 base64 内联 JSON 不引 multer;IAiMessage 增 images 附件→AnthropicChatModel.toApiMessages 生成 image content block→AiAgent 从 item.binary 拾图片;chatBodySchema+ExecutionService.chat 接附件存 binaryStore→seed 进 item.binary→ChatTrigger 透传;SttService 零依赖 multipart 打 Whisper 兼容端点(可注入 fetchImpl)+GET/PUT /stt-config(apiKey 不回显)+POST /chat/transcribe;前端 chat 面板 📎附件(File→base64+chip 预览)+🎤录音(MediaRecorder→转写填输入);express.json 限提到 15mb;3 节点测+3 chat 附件 server 测+4 STT 测全绿;活体验证附件/录音按钮渲染+chat 往返无回归）
- [x] **33. 凭证专属表达式模式** `M`（仅 `$secrets`/env 补全的专用控件，见 gap-list P2-4 收回记录）✅ 2026-07-23（新建 CredentialExpressionField.vue 专用控件——刻意不复用节点 ParamInput/ExpressionInput（复用会误导用户以为支持 $json/item 表达式）；ABC⇄{{ }} 切换、值含 $secrets 表达式则初始即表达式态、聚焦补全 $secrets 键 chip（按 $secrets. 后片段过滤、插入替换未闭合片段）；表达式态明示"只有 $secrets、无 $json 上下文"、externalSecrets 未启用/无键分别提示；CredentialModal text/password 字段接入并拉 api.externalSecrets 键；6 组件单测+84 前端测全绿；活体验证 HTTP Header Auth 的 Header value 切表达式态显作用域提示+"No external secrets found"、控制台零报错）

## P8 · n8n 表对照补差 · 小而快 + 正确性（来源：2026-07-22 自托管 n8n 库对照盘点）

- [x] **34. 每用户收藏（user_favorites）** `S` ✅ 2026-07-23（新表 user_favorites 复合主键(userId+resourceType+resourceId)双方言+迁移0027;FavoriteRepository(add/remove/listResourceIds/isFavorite/backfillFromWorkflowFlag);workflow-service.list 传 userId 时按本用户收藏覆写每行 favorite;/workflows/:id/favorite 改写 user_favorites 并回显本用户状态;bootstrap 一次性回填全局 favorite→各项目 owner(settings 标志位保证只跑一次,避免重启复活);workflows.favorite 列转休眠仅作回填来源;4 server 测(双用户各收藏不同流各见各的、同流互不影响、取消只影响本人、端点回显)验收"双用户各自星标互不可见";前端 API 形状不变无需改)

- [x] **35. 执行标注 + 自定义元数据** `M` ✅ 2026-07-23（4 表双方言+迁移0028。**35a 标注**：execution_annotations(vote👍👎/note,1:1)+annotation_tags(name 唯一)+execution_annotation_tags(多对多);ExecutionAnnotationRepository(get/setAnnotation 部分更新不清空/setTags 全量替换/findOrCreateTag);GET/PUT /executions/:id/annotation+GET /annotation-tags(归属经 executions.getById 校验);前端 CanvasView 执行详情标注栏 👍👎+tag chip(datalist)+note(change+enter 双触发);5 server 测。**35b 元数据**：execution_metadata(KV 复合主键+key/value 索引);SetMetadata 节点(_nmMetadata 保留键,值转字符串,引擎零耦合);ExecutionService.runEngine 收尾从 runData 提取 KV→replaceAll(所有 run 模式单一 choke point);GET /executions?metaKey&metaValue 过滤(findAllByProject join+selectDistinct);getById 带 metadata;前端执行详情 METADATA chips+列表 key/value 过滤;3 节点测+3 server 测。全量 752 测通过;活体验证标注 👍/tag/note 落库刷新还原、SetMetadata 写 customerId/stage→详情 METADATA 展示+列表按键值筛出(nomatch→空)）

- [x] **36. SSO 身份绑定表 + 同步历史** `M` ✅ 2026-07-23（2 表双方言+迁移0030:auth_identities(userId↔providerType/providerId,unique(type,id))+auth_provider_sync_history(scanned/created/updated/disabled/error/status)。AuthIdentityRepository(findUserId/bind 幂等/recordSync/listSyncHistory);provisionSsoUser+loginViaSso 增 provider 参数——优先按绑定认归属(email 变更/多 provider 不错认),新用户登录后建绑定;OIDC 传 sub、SAML 传 nameID、LDAP 传 ldapId(authenticate 扩查 ldapIdAttribute,ILdapProfile 增 ldapId);runSync 改绑定感知(先 ldapId 后 email,改 email 不重复建)+记同步历史+返回 scanned/disabled;users.update 支持 email;GET /ldap/sync-history(admin);前端 LDAP 设置页加载持久化同步历史(跨刷新可查)。3 server 测(登录/同步改 email 后同一 user、跨路径绑定一致、同步历史可查)+更新既有 settings-wiring 测;全量 759 测通过）

- [x] **37. 登出令牌黑名单（invalid_auth_token）** `S` ✅ 2026-07-23（新表 invalid_auth_tokens(token_hash PK + expires_at)双方言+迁移0029;AuthTokenBlacklistRepository 带内存缓存(鉴权热路径每请求查,不打库;add 增量更新;pruneExpired 顺手清过期);AuthService.logout(decode 取 exp→拉黑 sha256(JWT));POST /auth/logout(公开,验签通过才拉黑,幂等);中间件验签后查黑名单→401;**修正 JWT 同秒重签碰撞**:issueToken 加 jwtid(否则同秒同用户两 token 全同,登出误伤新 token);前端 auth store logout 调 api.logout 尽力拉黑;4 server 测(登出后旧 token 401、重登新 token 不受影响、幂等)验收"登出后旧 token 立即 401";全量 server 457+frontend 84+db 26 通过)

## P9 · n8n 表对照补差 · 基础设施

- [x] **38. DB 调度器（scheduled_job + scheduled_task）** `L` ✅ 2026-07-23（地基项，解锁 #39/#44）。**38a 引擎**：2 表双方言+迁移0031(scheduled_jobs recurrence+nextRunAt 持久化;scheduled_tasks 到期实例+租约 claimedBy/leaseExpiresAt/leaseEpoch,unique(jobId,scheduledFor) 去重);SchedulerRepository(materializeTask onConflictDoNothing/claimTask leaseEpoch 乐观锁原子认领/failTask retry);SchedulerService(computeNextRun cron 带时区/interval/once;tick 两阶段物化+推进 nextRunAt+租约认领触发;fire/now/instanceId 可注入);8 单测(多实例只触发一次、claim 原子性、重启恢复、失败重试)。**38b 集成**：ActiveWorkflowManager 把 nomops.schedule 节点路由到 DB 调度器(幂等 upsert job,不判 leader,靠 unique+租约去重,修复旧设计只激活时判 leader、leader 变更漏触发的缺口);remove 停用作业;无效 cron→激活报错;bootstrap 起 SchedulerService(fire=runTriggered,配额 429 跳过);server 加 cron-parser;3 集成测(激活建 job/到期 tick 触发/停用停 job)+改造既有 triggers 测。全量 770 测通过。验收：双实例并发同一 cron 只触发一次✓;重启后 nextRunAt 恢复继续✓）

- [x] **39. Insights 预聚合管线** `M/L` ✅ 2026-07-23（卷积任务用 #38 调度器）。**39a**：3 表双方言+迁移0032(insights_raw 执行收尾事件,与 executions 保留期解耦;insights_by_period 日桶;insights_metadata 名快照);InsightsRepository;runEngine 收尾 recordInsights(算 runtime+快照名);/insights 改读 insights_raw+?scope=all 跨项目(admin);2 测(删执行后数字不变+跨项目)。**39b**：InsightsService(rollup 把边界(今-7天)前未卷积 raw 按项目×日折进 by_period+markRolledUp+prune;summary 合并 by_period(旧)+未卷积 raw(近期),findRawInRange 排除已卷积防重复计);bootstrap 注册全局 insights-rollup 调度作业(每小时,SchedulerService fire 按 kind 分派);2 测(卷积后合并两源数字不变+小时粒度近期只读 raw)。全量 774 测通过。验收：删执行后 Insights 数字不变✓;跨项目聚合视图可用✓

- [x] **40. 发布管线深化** `L` ✅ 2026-07-23（3 表双方言+迁移0033）。**40a**：workflow_publish_history(publish/rollback 事件史)+publication_trigger_status(逐触发器 active/error);PublishPipelineRepository;ActiveWorkflowManager.add 逐节点记 trigger status(webhook/schedule/poll 成功 active,冲突/无效 cron error 再抛);publish/restore 记史、deactivate 清状态;GET publish-history+trigger-status;前端 Publish Timeline tab 从占位改真实事件列表;3 测。**40b**：credential_dependency;WorkflowService.create/update 保存时从 node.credentials 重建索引、delete 清依赖;GET /credentials/:id/usage 列引用方;前端 CredentialModal 删前把引用工作流名列进确认框;3 测。全量 780 测通过。验收：触发器激活失败在 UI 有状态与错误✓;发布史可回看✓;删被引用凭证前可见引用方✓（publication_outbox 失败重放/workflow_dependency 子流索引不在验收内,未做）

- [x] **41. Chat 工具体系** `M/L`（与 #32 多模态互补）✅ 2026-07-23（消息带 workflowId/executionId 关联——工作流工具会话对话即触发执行、消息可跳执行详情。ChatView Msg 增 executionId/workflowId;send() 对 workflow 目标把 res.executionId(服务端已返回,此前被丢弃)+workflowId 挂到助手消息;消息气泡加 "Open execution" 按钮 → router.push /workflow/:id?tab=executions&exec=:execId(CanvasView 已解析);消息经 chatSessionUpsertSchema 的 z.record 宽松存储自动持久化,无需改服务端;前端 84 测通过;活体验证工作流工具会话发消息→"ran: …"回复带 Open execution→点击跳到该次执行详情(Success·chat·选中)、控制台零报错。多工具挂载 hub(chat_hub_tools/session_tools/agent_tools 多对多让 agent 挑工具)超出单工具验收,未做——当前"会话目标即挂载的那一个工作流工具"已满足验收）

- [x] **42. SSO 角色映射规则（role_mapping_rule）** `M` ✅ 2026-07-23（2 表双方言+迁移0034:role_mapping_rule(sourceType/matchKey/matchValue/projectRole/ordering)+role_mapping_rule_project 多对多;RoleMappingRepository 带登录热路径缓存;AuthService.loginViaSso 后 applyRoleMappings——按 ordering 降序,ldap-group 命中 memberOf/oidc-claim 命中声明(claimMatches 支持标量或数组),同项目多规则取最高优先,projects.setMemberRole 幂等只加/改不删;LDAP authenticate 取 memberOf→ILdapProfile.groups→login 传;OIDC 传 claims;规则 CRUD API(实例 admin)GET/POST/DELETE /role-mappings;3 server 测(LDAP group 命中→自动 editor、不命中→不加入、规则列表可查)验收"LDAP group → 项目成员自动生效";全量 server 484 通过。规则管理 Settings UI 未做(验收是自动生效,已由 API+登录评估满足)）

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
