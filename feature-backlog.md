# nomops 功能开发待办清单（feature-backlog）

> 来源：2026-07-21 全项目缺口盘点（引擎/服务端/节点/前端四路代码审计 + diff-ledger + ui-audit gap-list 交叉）；2026-07-22 增补 P8-P10（自托管 n8n 库 110 表逐一对照，#34-47）；2026-07-22 增补 P11（n8n 2.30.4 节点面板全目录 `/types/nodes.json` 对照，Core Node 缺口 34 个 → #48-54，详见 `docs/node-catalog-gap.md`）；2026-07-25 增补 P12-P15（14 域并行对标审查 n8n 2.31.0 `038d2ca286`，抓踩坑/缺能力/抢跑三类 → #55-76，详见 `benchmark-gap.md`）。
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

- [x] **18. SMTP 邮件投递** `M` ✅ 2026-07-22（零依赖手搓 SMTP 客户端(EHLO/STARTTLS 升级/AUTH LOGIN/dot-stuffing/多行应答,同 metrics·TOTP 取舍);NOMOPS_SMTP_* 环境变量,未配置 NullMailer 保持日志回退;重置/邀请两流接线(fire-and-forget 不给枚举面);4 server 测(假 SMTP 服务器全协议+记录桩接线)）。✅ 2026-08-02 加固：SMTP 已启用时不再向日志输出密码重置 token；TLS 证书保持默认严格校验，可对明确信任的本地自签名邮服单独显式关闭；Message-ID 使用真实发件域而非 `nomops.local`。`accounts@nomops.com` 本地自投递成功，发往 `guowangkun@outlook.com` 已获 SMTP 接收回执但 Outlook 未实际收到；定位为邮服未添加 DKIM、PTR 仍是 Vultr 通用主机名且 TLS 使用自签名证书，外部可投递性待邮服/DNS 运维修复；邮件/重置定向 8 测、全量构建 6/6 与全量测试通过。

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

- [x] **43. 平台零散补差清扫** `S/M` ✅ 2026-07-23（4 表/列双方言+迁移0035）。**instance_version_history**：bootstrap 启动检测版本变化即记(NOMOPS_VERSION 覆盖,缺省 0.1.0);GET /instance/version-history(admin)。**mcp_registry_server**：缓存表+GET /mcp-registry+POST /refresh(无外部客户端时写策划目录充当缓存源)。**users.settings**：users 加 settings JSON 列(可空,读处 ?? {})+GET /me 回显+PUT /me/settings;前端 ui store hydrateFromServer/persistToServer,App 登录后拉 /me 水合、toggleSidebar/setSidebarWidth 落库(DB 为准替 localStorage)。**folder_tag**：folder_tag_mapping 复用 tags+GET/PUT /folders/:id/tags。PlatformRepository+UserRepository.updateSettings。4 server 测(逐项)+活体验证 users.settings(清 localStorage→设服务端 sidebarCollapsed→重载侧栏仍折叠,证 DB 为源)。**活体验证抓到并修复真 bug**：迁移向已有数据的 users 表 ADD NOT NULL settings 列在 SQLite 报错(测试用空内存库未暴露),改为可空列。全量 787 测通过

## P10 · n8n 表对照 · Epic/远期（独立立项，先规划再动工）

- [x] **44. EPIC-AGENTS Agents 平台** `XL` ✅ 全部完成 2026-07-24（规划见 [docs/12-EPIC-AGENTS-PLATFORM.md](docs/12-EPIC-AGENTS-PLATFORM.md)）。**✅ M1 定义+版本已完成（2026-07-24）**：agents+agent_history 双方言+迁移0036;AgentRepository(CRUD+版本快照+publish/rollback,仿 workflow_versions);项目级归属;路由 GET/POST/PATCH/DELETE /agents + publish/versions/restore;bootstrap 一次性把旧 chat_agents 迁进 agents(各自个人项目,非破坏,settings 标志位保只跑一次);前端 AgentsView(列表/建/编辑 system/发布/版本回滚)+ 侧栏 Agents 入口 + 路由。6 server 测+活体验证;全量 793 测通过。**✅ M2 线程化执行+成本核算已完成（2026-07-24）**：agent_threads/runs/messages 3 表+agents.backingWorkflowId 列(迁移0037);token 用量跨层管线(IAiChatResponse.usage←ChatModel 解析 provider usage(anthropic input/output_tokens、openai prompt/completion_tokens)←AiAgent 跨轮累加→输出 _nmUsage 保留键);AgentRunService 把 agent 按 config 组装成后备工作流(ChatTrigger→AiAgent→ChatModel,provider→credType 映射)经现有引擎跑→execution,从 runData 提 _nmUsage 算成本(computeCost 计价表 micros/token),记 thread/run(executionId/tokens/costMicros)/message;ExecutionService 加可注入 httpRequest(测试假 provider);路由 POST /agents/:id/chat + GET threads + GET thread(runs+messages);前端 AgentsView 加 MODEL 配置(provider/model/凭证选择)+ Test chat 面板(消息气泡+每 run token/成本+open execution 深链)。7 node 测(usage 累加)+5 server 测(extractUsage/computeCost 纯函数、假 provider 全链 token/成本/executionId、线程 runs/messages、续跑)+**真 DeepSeek API 活体全链验证**(建 agent→配 deepseek+凭证→发消息"Hello, I'm here."·17→6 tok·$0.000011→open execution 跳到后备工作流 Chat→Agent→Model 图的执行详情、控制台零报错);全量 799 测通过。**✅ M3 分层记忆+证据链已完成（2026-07-24）**：memory_entries/memory_observations 2 表双方言+迁移0038(entries：agentId/threadId/scope(agent 默认)/kind(fact)/content/embedding(json 向量)/lastUsedAt;observations：entryId→runId+evidence(证据链))+AgentRepository(addMemory/memoriesForAgent/touchMemory/addObservation/listMemoriesWithObservations);AgentRunService 加**可插拔本地哈希词袋 embedding**(embed 64 维归一化/cosine/topKMemories,生产可注入 provider embedding)——每轮 chat 先 embed 消息→取 agent 域 top-k 记忆→拼进本轮 system(注入 buildBackingNodes 的 systemOverride,不改 agent 存量 config,touchMemory 记命中);跑完把用户消息存为 agent 域记忆+一条 observation 链到本次 run(证据链);顺手修 ensureBacking 韧性(后备工作流被删→findById 核实不存在则重建,不再永久 500);路由 GET /agents/:id/memory(记忆+来源运行);前端 AgentsView 加 Memory 面板(scope·kind 徽标+内容+"from run ↗"跳执行)。6 server 测(embed 归一化/cosine 相关>无关/topK 排序过滤 3 纯函数 + 假 provider 断言召回注入 system、证据链 observation→run、新线程召回旧线程偏好)；**真 DeepSeek API 活体跨线程验证**(线程 A 说"favorite color teal + metric units"→新线程 B 问"我的偏好?"→答"teal + metric"、GET /memory 两条各链到来源 run、UI Memory 面板双条+run 深链截图)；全量 805 测通过。**✅ M4 定时任务已完成（2026-07-24）**：agent_task_definitions 表双方言+迁移0039(agentId/projectId 冗余免 join/name/message 每次触发发给 agent 的指令/schedule(复用 #38 config 形态 cron|interval|once)/timezone/active/jobId 回链 scheduled_jobs/threadId 专属线程/lastRunAt);AgentRepository 任务 CRUD(createTask/listTasks/findTask 归属版+findTaskById 调度侧无归属版/updateTask/deleteTask);AgentRunService：createTask 先校验 schedule 算 nextRunAt 再落库+建 scheduled_job(kind=agent-task,config.taskId 回链)、updateTaskDef 变更重算 nextRunAt+active 开关同步停启作业、deleteTaskDef 停作业删任务行、runTask fire 分派入口(任务已删/停用静默跳过;历次触发聚在 channel=schedule 专属线程可回看;记 lastRunAt);bootstrap fire 加 kind=agent-task 分支(429 同工作流口径跳过);**双实例只触发一次靠 #38 租约,不建 run_lock(docs/12 决策)**;路由 GET/POST /agents/:id/tasks + PATCH/DELETE /tasks/:taskId;前端 AgentsView 加 Scheduled tasks 面板(建任务 name/message/Interval|Cron+列表 schedule 标签/last run/Pause/Resume/Delete)。6 server 测(建任务 job 回链 nextRunAt 已算、无效 cron 400 不落行、暂停停作业恢复重排期、删任务停作业、once 到期 tick 全链触发 channel=schedule 线程+execution+触发后不重复、已删任务残留作业静默跳过);**真 DeepSeek 活体验证**(API 建 once 到期任务→后台调度循环 3s 内自动触发→线程 channel=schedule·61→11 tok·µ$29·链 execution,回复"feeling bright and teal"证明 M3 记忆在定时路径同样生效;UI 面板任务行+last run+Pause/Delete 截图,控制台零报错);全量 811 测通过。**✅ M5 文件+外部渠道已完成（2026-07-24）**：agent_files+agent_channels 2 表双方言+迁移0040(files：binaryId 复用 #32 binaryStore/fileName/mimeType/size;channels：type/credentialId(bot token 走凭证系统,铁律 3)/config(webhookSecret)/active;线程复用 M2 预留的 externalRef 列做渠道会话映射);AgentRepository(files+channels CRUD+findChannelById 公开侧无归属版+findThreadByExternalRef/createThread 支持 externalRef);AgentChannelService：建渠道校验 agent+凭证归属、生成随机 webhookSecret、尽力自动 setWebhook(公网不可达不阻塞,可拿 webhookUrl 手动注册,docs/12 风险已料);handleTelegramUpdate 公开入口(渠道不存在/停用/secret 不匹配一律 404 不泄露存在性;同 chat_id 经 externalRef 复用同一线程上下文连续;跑完 sendMessage 回复回渠道,token 解密即用即弃不落日志,HTTP 非 2xx 显式记警告);bootstrap 注入 telegramFetch(测试假实现);路由：files 上传(base64→binaryStore,binaryId 不出 API)/下载/删除+channels CRUD(认证侧)+POST /webhook/agent-channel/:channelId/:secret(公开,先于通配 webhook 注册);前端 AgentsView 加 Files 面板(上传/下载/删除)+Channels 面板(telegramApi 凭证选择+Connect Telegram+Copy webhook URL/Pause/Delete)。7 server 测(文件 base64 上传→列表不含 binaryId→下载回读→删除、跨 agent 归属 404、建渠道 webhookUrl 带 secret+自动 setWebhook 断言 token 不出 API、模拟 update 触发 agent+sendMessage 回同 chat_id、同 chat_id 复用线程/异 chat_id 开新线程、错 secret/停用一律 404、非文本确认不触发);**活体验证**(真 DeepSeek：文件上传/下载回读一致→建渠道→模拟 Telegram update 打公开 webhook→channel=telegram 线程 externalRef=chat_id→跨渠道召回 M3 记忆答"teal"/"metric"→同 chat_id 二发复用线程 2 runs→假 token 回发被拒记"HTTP 401"警告不落 token→错 secret 404;UI Files/Channels 面板截图,控制台零报错);全量 818 测通过。**#44 Epic 五里程碑全部完成**。
  n8n 20 表体系：agent 定义/发布版本（agents + agent_history）、线程化执行 + token/成本核算（agent_execution*）、分层记忆（memory_entries + observations，embedding + 证据链）、定时任务（task_definition + run_lock，依赖 #38）、文件、外部渠道订阅（Telegram 等）。现仅 chat_agents 单表（name + system）。先出规划文档再动工。

- [x] **45. EPIC-AI-BUILDER AI 生成工作流 + 实例助手** `XL` ✅ 全部完成 2026-07-24（规划见 [docs/13-EPIC-AI-BUILDER.md](docs/13-EPIC-AI-BUILDER.md)）——两条产品线(AI 建流会话 / 实例助手)共用「有检查点的 AI 线程」底座；数据模型(建流会话+临时流、线程/消息/检查点/运行树、HITL 待确认、观察-反思记忆、MCP 连接)、5 里程碑(M1 建流会话可独立交付)、关键决策(临时流隔离不进 workflows、检查点=可序列化状态、HITL 沿用安全边界、记忆/MCP 与 #44 共用抽象)已定。**✅ M1 AI 建流会话+临时流已完成（2026-07-24）**：workflow_builder_sessions/ai_builder_temporary_workflows 2 表双方言+迁移0041(session：userId/projectId 归属/title/goal/status(active|applied|discarded)/messages(json,服务端权威记对话不信客户端回传)/currentRevisionId 当前预览版/appliedWorkflowId;temp：sessionId/revision 递增/name/nodes/connections/summary——临时流不进 workflows 表,防列表污染+误激活,Apply 时才物化);WorkflowBuilderRepository(会话+草稿 CRUD,findSession 带 projectId 归属过滤);WorkflowBuilderService **复用 assistant-service 生成+结构校验(extractWorkflow)**——每轮 chat 喂累计对话→有合法草稿建新 revision(currentRevision 指向最新);rollback 回退 currentRevision 到任一版(不删后来的);apply 走 **WorkflowService.create** 物化为正式流(结构校验+初始版本 v1+凭证依赖索引 #40b),会话置 applied 记 appliedWorkflowId;discard 弃用;路由 GET/POST /builder/sessions + GET :id + POST :id/chat + GET revisions/:revId(供 ReadOnlyCanvas 预览) + POST rollback/apply + DELETE;前端 BuilderView 三栏(会话列表/多轮对话/ReadOnlyCanvas 草稿预览+revision 链回退+Apply→跳画布)+侧栏 AI Builder 入口+/builder 路由。10 server 测(建会话/多轮改流 revision 链/纯澄清轮不建版/预览取 nodes/回退到上一轮/Apply 落可运行工作流+会话 applied 记账/已 applied 不能再改 409/临时流不进 workflows 列表/未知会话 404);**真 DeepSeek 活体验证**(建会话→两轮生成迭代草稿 rev1 手动+Set/rev2 加 IF→UI 三栏预览 ReadOnlyCanvas 渲染 Manual Trigger→Set Status→点 v1 芯片回退画布降到 2 节点→Apply 物化为正式流跳画布,workflows 仅 1 条不含临时流,控制台零报错);全量 828 测通过。**✅ M2 有检查点的 AI 线程底座已完成（2026-07-24）**：instance_ai_threads/messages/checkpoints 3 表双方言+迁移0042(thread：userId 归属/kind(ops|builder)/title/state(json 可序列化工作态,铁律 4);message：threadId/seq 递增/role/content 追加日志;checkpoint：seq/label/state 快照/messageCount 快照时消息条数);InstanceAiRepository(线程 CRUD+归属过滤/追加消息 countMessages 定 seq/检查点 count+add/truncateMessagesAfter+truncateCheckpointsAfter 回滚截断);InstanceAiService：append 追加消息、setState 整体替换工作态、**checkpoint 快照 state+消息条数**、**restore 还原 state+截断检查点后消息+作废后续检查点→线程回到该步状态一致可续跑**、chat 复用 assistant-service(真·AI 线程,provider 中立,凭证/模型经 projectId 解析);检查点/回滚与 LLM 解耦(纯底座,铁律 4);路由 GET/POST /instance-ai/threads + GET/DELETE :id + POST messages + PUT state + POST checkpoints + POST restore + POST chat;前端 InstanceAiView 三栏(线程列表/对话+工作态 JSON 编辑/检查点条 存+回滚)+侧栏 Assistant 入口+/assistant 路由(复用 M1 内层 .row 包装绕开 App.vue 注入的 column)。8 server 测(建线程/追加消息+存检查点快照/继续走错/**从检查点恢复状态一致:state 还原+后续消息截断**/续跑 seq 无空洞/恢复作废后续检查点/对话一轮复用 assistant/归属 404);**真 DeepSeek 活体验证**(建线程→真实对话一轮→设工作态 state+存检查点 A→再对话+改 state 走错(4 消息/state WRONG)→UI 点 Restore→回到 2 消息+state 精确还原{phase:triage,findings}→控制台零报错);全量 836 测通过。**✅ M3 HITL 待确认已完成（2026-07-24）**：instance_ai_pending_actions 表双方言+迁移0043(threadId/tool/args/risk/reason/status(pending|approved|rejected)/result(批准执行后)/decidedBy/decidedAt);InstanceAiRepository(addPendingAction/listPendingActions/findPendingAction/decidePendingAction);instance-ai-tools 模块：**风险分级 classifyRisk**(SAFE_TOOLS 白名单=echo/list_workflows;其余含未知一律 dangerous,fail-safe「拿不准就要人确认」)+**可插拔 ToolExecutor**(内置 echo/list_workflows/archive_workflow,危险工具经 projectId 归属校验,铁律 2,M5 会扩到 MCP);InstanceAiService 加 HITL：**proposeAction**(安全直接执行记 tool 消息;危险挂 pending 不执行)、**approveAction**(执行工具→记结果+approved,只 pending 可批)、**rejectAction**(不执行只记 rejected),归属经线程校验;路由 GET/POST /instance-ai/threads/:id/actions + POST actions/:actionId/approve|reject;前端 InstanceAiView 加 Actions·HITL gate 面板(Propose 工具+参数、pending 动作红标 needs approval+reason+Approve&run/Reject),tool 消息进对话审计日志。7 server 测(风险分级纯函数/安全动作直执/危险挂 pending 不执行/**拒绝不执行 workflow 保持原样**/**批准执行 workflow 被归档+结果记账+tool 消息**/重复决定 409/未知工具批准 400 不静默);**真实活体验证**(建线程→list_workflows 安全直执→archive_workflow 危险挂 pending workflow 未归档→拒绝 workflow 仍未归档→批准 workflow 归档=True;UI Propose→pending 红标→点 Approve&run→workflow archived=True,控制台零报错)。全量 843 测通过。**✅ M4 运行树+观察-反思记忆已完成（2026-07-24）**：先把 #44 的 embed/cosine/topKMemories 抽到 **embedding.ts 共享模块**（docs/13 决策 4，#44/#45 共用,agent-run-service re-export 保兼容);instance_ai_run_tree+instance_ai_memory 2 表双方言+迁移0044(run_tree：threadId/parentId 自引用成树/label/input/output/status(running|success|error)/endedAt;memory：userId 归属/threadId/scope(instance 跨线程|thread 本线程)/kind(observation|reflection)/content/embedding json);InstanceAiRepository(addRunNode/finishRunNode/listRunNodes;addMemory/memoriesForRecall 按 userId+scope 过滤/listMemories);instance-ai-tools 的 ToolContext 加 span 回调(工具可把多步记成子树)，archive_workflow 拆成 find_workflow+set_archived 子调用演示嵌套;InstanceAiService：**execToolWithTree**(建根节点→执行 ctx.span 记子调用→收尾 success/error,proposeAction 安全路径与 approveAction 都经它,每个执行动作进运行树)、**remember**(embed 内容落库,scope=instance 跨线程)、**recall**(embed query→候选 top-k)、listRuns/listMemories;embedding 向量不出 API;路由 GET threads/:id/runs + POST threads/:id/memory + GET /instance-ai/recall;前端 InstanceAiView 加 Run tree·observability(根+子调用缩进,success/error/running 彩点)+Memory·cross-thread(remember 表单 scope 选择+recall 搜索+结果)。6 server 测(执行工具运行树有根+子调用 find/set/**安全动作也进树**/**失败动作节点标 error**/线程 A 记 instance 反思/**跨线程召回 A 的反思**/**thread 域只本线程召回不跨线程**)+agent-memory 测仍绿(embedding 重构未破坏);**真实活体验证**(线程 A 记 billing 反思→线程 B 相关 query 跨线程召回;archive_workflow 批准→运行树 archive_workflow→find_workflow+set_archived 全 success;UI Run tree 彩点嵌套+Memory recall 命中,控制台零报错);全量 849 测通过。**✅ M5 MCP 连接已完成（2026-07-24）**：instance_ai_mcp_connections 表双方言+迁移0045(userId 归属/threadId/serverName/url/config(含 token,不出 API/不进日志)/status/tools 缓存连接时发现的工具清单);InstanceAiRepository(addMcpConnection/listMcpConnections/findMcpConnection/deleteMcpConnection);instance-ai-mcp 模块：**McpClient 接口 + HttpMcpClient**(真·MCP Streamable HTTP 最小子集 JSON-RPC：initialize→tools/list→tools/call,config.token→Bearer,与 nomops 自身 McpService 对齐可回环自连)+工具名约定 mcp/<connId>/<tool>;classifyRisk 把 mcp/ 工具判 dangerous(外部 fail-safe→走 HITL);buildDefaultToolExecutor 路由 mcp/ 工具→查连接(归属校验)→mcpClient.callTool;InstanceAiService：connectMcp(拉工具清单落库,url 校验 http(s))、listMcpConnections(config/token 不出 API,connView 剥离)、disconnectMcp、mcpRegistryCandidates(候选源=#43 registry 缓存);bootstrap 注入 mcpClient(测试假实现);路由 GET mcp/connections+mcp/registry + POST threads/:id/mcp/connect + DELETE mcp/connections/:connId;前端 InstanceAiView 加 MCP servers·tools 面板(连接表单 name/url/token+已连服务器列工具 chip,点 chip 提议 mcp 工具走 HITL)。8 server 测(MCP 工具风险分级 dangerous/挂 server 存工具清单 token 不出 API/连接列表可见/提议 MCP 工具走 HITL 挂 pending 不执行/批准经 MCP client 执行+进运行树/别人连接 id 批准 404 归属/断开移除/非 http url 400);**真·MCP 回环活体验证**(enable nomops 自身 MCP server→建+发布 workflow 暴露为 tool run_ping_tool→**assistant 经 HttpMcpClient 真 JSON-RPC 连 nomops MCP 端点**→发现工具 token 不出 API→提议→HITL pending「External MCP tool requires approval」→批准→真 tools/call 跑 workflow 回 pong:true→运行树记 mcp 调用 success;UI MCP servers 面板显示 nomops(loopback) connected+工具 chip,控制台零报错;验毕 disable 恢复实例态);全量 857 测通过。**#45 EPIC-AI-BUILDER 五里程碑全部完成**。
  n8n 16 表体系：workflow_builder_session / ai_builder_temporary_workflow（AI 建流会话 + 临时流）、instance_ai_*（线程/检查点/运行树快照/HITL 待确认/观察-反思记忆/MCP 连接）。现 chat 的 wfSessionId 仅雏形。先出规划文档再动工。

- [x] **46. EPIC-DYNAMIC-CREDENTIALS 动态凭证** `L/XL` ✅ 全部完成 2026-07-25（规划见 docs/14,2026-07-24 触发立项，见 [docs/14-EPIC-DYNAMIC-CREDENTIALS.md](docs/14-EPIC-DYNAMIC-CREDENTIALS.md)）——embed/白标/多租户：一个逻辑凭证运行时按 subject 解析成不同实际值。解析在 `getDecryptedData` 唯一 choke point 切入（与 $secrets 相邻），引擎/core 零改动；铁律 3 解析值即用即弃。3 里程碑(M1 表解析器可独立交付)。**✅ M1 数据模型+表解析器+getDecryptedData 贯通已完成（2026-07-24）**：credentials 加 isResolvable/resolverId 两列 + dynamic_credential_resolvers/dynamic_credential_entries 2 表双方言+迁移0046(resolver：projectId 归属/name/kind(table\|http)/config;entry：resolverId/subject/data 密文,unique(resolverId,subject));DynamicCredentialRepository(resolver CRUD+归属过滤;entry upsert/findEntry/listEntrySubjects 不含 data 密文/deleteEntry)+CredentialRepository.setResolver;**DynamicCredentialService**(可插拔 ICredentialResolver + 内置 **TableResolver** 按 subject 查 entry→解密;createResolver/setEntry 加密落库/listSubjects/deleteEntry,归属校验)放 ee/services(license 门 dynamicCredentials,ee-boundary 约束);**CredentialService.getDecryptedData(id,projectId,subject?)** 在凭证 resolvable 时经解析器按 subject 取值(不解密 row.data,仍过 secrets.resolve),缺 subject fail-fast,非 resolvable 零影响;IDynamicCredentialResolver 接口在社区侧(依赖方向不破);路由 POST/DELETE /credentials/:id/resolver(挂/摘,owner)+GET/POST/DELETE /dynamic-credentials/resolvers+GET :id/subjects(值不出)+PUT/DELETE :id/entry;前端 SettingsView 加 Dynamic Credentials 段(license 锁卡/解析器列表+新建/挂到凭证/subject 值管理增删,值只进不出)+settings-nav 入口;LICENSE_FEATURES+ALL_TEST_FEATURES+dev-license 加 dynamicCredentials(重生成 12 features)。11 server 测(建凭证+建解析器 config 不出 API/标 resolvable/加两 subject 值不出 API/**getDecryptedData 按 subject 返不同实际值**/缺 subject fail-fast/未知 subject 404/upsert 覆盖/删 subject 再解析 404/解除 resolvable 回退固定密文/非 resolvable 不受影响/license 门 403)+ee-boundary 测(功能位实现在 ee 内);**真实活体验证**(API：建凭证+table 解析器→挂到凭证 204→加 acme/globex 两 subject 值 204→列 subject 只回名+时间不回值;UI：Settings→Dynamic Credentials 段解析器列表+subject 值 acme/globex+挂凭证选择器渲染,「stored encrypted never returned」,控制台零报错);全量 868 测通过。**✅ M2 运行时按 subject 贯通引擎+user_entry+http 解析器已完成（2026-07-25）**：dynamic_credential_user_entries 表双方言+迁移0047(resolverId/userId/data 密文,unique(resolverId,userId))+repo(upsertUserEntry/findUserEntry/listUserEntryUsers 不含密文/deleteUserEntry,deleteResolver 连带清 user_entries);**subject 运行时贯通引擎**——ExecutionService 加 IRunContext{subject?,userId?},buildAdditionalData→getCredentials 闭包→getDecryptedData(id,projectId,subject,userId),经 runEngine extras/runSubWorkflow 贯通(子流继承),runManually options.runContext;POST /workflows/:id/run 加 subject(runBodySchema),runContext={subject,触发者 userId};**引擎/core 零改动**(只经 additionalData 闭包);TableResolver 加 user_entry 回退(subject 无值→按 ctx.userId 取 user_entry);**HttpResolver**(embed/白标：POST {subject,projectId} 到 config.url,config.token→Bearer,注入 fetch,值不落库)经 backends.http 内置;DynamicCredentialService.resolve 加 userId 参、构造第三参改 {fetchImpl?,extraBackends?};IDynamicCredentialResolver+getDecryptedData 加 userId 参;bootstrap 注入 dynamicCredentialFetch;user_entry CRUD 路由(GET :id/users 值不出+PUT/DELETE :id/user-entry);前端 SettingsView 段加 kind 选择(table/http)+http 端点 url 输入+User values 管理(增删,回退说明)。8 server 测(user_entry 回退/subject 优先 user_entry/user 列不泄露/http 解析器按 subject 取值 + **run as subject=acme 注入 acme token**/**run as subject=globex 注入 globex token 同流同凭证值随 subject 变**/**run 无 subject 回退触发者 userId 的 user_entry**——经 Telegram getMe 节点声明式注入+注入 httpRequest 捕获 URL 中的 token 断言,铁律 3 值进请求不进执行输出);**真实活体验证**(API：建 http 解析器 config/token 不出 API→建 table 解析器+subject entry+user_entry→users 列不泄露值;UI：Settings→Dynamic Credentials 段渲染 http 解析器+kind 选择器+subject 值 tenant-acme+User values c609fdcb,控制台零报错);全量 876 测通过。**✅ M3 管理台完善+审计+批量导入已完成（2026-07-25）**：AuditLogRepository 加 findByResource(projectId,resourceType,resourceId)；所有动态凭证变更埋审计(resourceType=dynamic-credential/resolverId,action=dyncred.resolver-create|delete/entry-set|delete/user-entry-set|delete/entry-import)——**只记元数据(谁/何时/哪个 subject),绝无值(铁律 3)**；DynamicCredentialService 加 importEntries(批量 {subject:{值}} 加密 upsert,校验对象)+listAudit(按 resolver 过滤,归属校验);AUDIT_RESOURCE 常量社区/ee 共用;路由 POST :id/import + GET :id/audit(license 门);前端 SettingsView 段加 Bulk import(贴 JSON 一次建多条)+Audit 面板(人读 action 标签+时间,无值)+subject 行 Rotate(预填表单覆盖)。8 server 测(建/存/删各记对应审计 action/**entry-set 审计含 subject 不含值**/审计按 resolver 过滤不串/批量导入建 3 条+审计记 count 不记值/非对象值 400/空导入 400/license 门 audit+import 403);**真实活体验证**(API：批量导入 3 subject 201→审计记 resolver-create+entry-import 无 SECRET 值泄露;UI：Settings→Dynamic Credentials 选 m3-demo→subjects acme/globex/initech+Bulk import 框+Rotate 按钮+Audit 面板「imported subject values/created resolver」+时间,控制台零报错);全量 884 测通过。**#46 EPIC-DYNAMIC-CREDENTIALS 三里程碑全部完成**。

- [x] **47. 实例信任密钥链** `M` ✅ 完成 2026-07-25（实例联邦信任底座,Cloud/企业）：deployment_keys/trusted_keys/trusted_key_sources/token_exchange_jti 4 表双方言+迁移0048;instance-token.ts 令牌原语(复用 license-cert 同款 Ed25519:generateDeploymentKeypair/signInstanceToken 紧凑 EdDSA JWT/verifyInstanceToken 验签+exp/kidFor=公钥 sha256);InstanceTrustRepository(部署密钥 active/轮换 deactivateAll;trusted upsert 按 kid/找/删;JWKS 源 CRUD+markFetched;recordJtiIfNew onConflictDoNothing 防重放+pruneExpired);**InstanceTrustService(ee,license 门 instanceTrust)**：ensureDeploymentKey(私钥经 Cipher 加密落库,铁律 3)、publicJwks(标准 OKP/Ed25519)、rotateDeploymentKey(旧钥留验证窗口)、signToken(iss=kid/jti/exp)、**exchangeToken(RFC 8693 简化:按 kid 找信任密钥验签+exp+jti 防重放→换发本实例令牌,act 标委托来源)**、addTrustedKey(jwk→DER)、addSource/refreshSource(拉 JWKS upsert 信任密钥,注入 fetch)/removeSource;公开路由 GET /instance-trust/jwks + POST /instance-trust/token/exchange(对端无会话,靠签名令牌自证,license 门);/api admin(instance-admin+license)：GET status/POST rotate/trusted-keys CRUD/sources CRUD+refresh/sign;bootstrap 注入 instanceTrustFetch;前端 SettingsView 加 Instance Trust 段(本实例 JWKS URL+kid+Rotate、信任源增删刷、信任密钥列+手动加)+settings-nav 入口;LICENSE_FEATURES+ALL_TEST_FEATURES+dev-license 加 instanceTrust(重生成 13 features);ee-boundary homes 补 instanceTrust。11 server 测(令牌签验往返/过期/篡改/异钥;两实例联邦 A 签→B 信任→交换成 B 令牌 subject 保留 actor=A;**重放 409**;不信任 401;过期 401;JWKS 源刷新拉公钥;轮换旧钥留 JWKS;公开路由 license 门 403;admin status);**真实回环活体验证**(dev license 重生成含 instanceTrust→JWKS 出 OKP 公钥→自指 JWKS 源信任本钥→sign 令牌→公开 exchange 换 B 令牌 subject/actor 对→**replay 409**;UI Settings→Instance Trust 段渲染 kid/JWKS URL/自 loopback 源/信任密钥,控制台零报错);全量 895 测通过。**✅ M2「对齐」已完成（2026-07-25，对照本地 n8n 2.31.0 token-exchange 逐一比对后补齐三缺口）**：**(1) 校验策略 + 身份透传**——validateClaims 按源 config 强校验 iss/expectedAudience/allowedRoles(不匹配 403),exchangeToken 返 {token,actor,subject,claims} 并透传身份 claims(email/given_name/family_name/role)供宿主 provision;**(2) 多态源 + 健康态**——trusted_key_sources 加 type(jwks\|static)/config(JSON,含校验策略)/status(pending\|healthy\|error)/lastError 4 列双方言+迁移0049(sqlite 手改 ALTER ADD COLUMN 避 drizzle-kit 重建表 bug),addSource({type,name,config}):jwks 校验 config.url+首拉尽力(健康态记源上不阻塞建源)/static 内联公钥(base64 DER 或 JWK x)立即物化;refreshSource jwks 拉/static 重物化,成功 healthy 失败 error+lastError;**(3) 信任密钥源域化**——addTrustedKey 改为内部建 static 源(issuer 作展示标签非 iss 策略,手动加即信任),status/trustedKeys 带 sourceName;repo addSource 新签名+setSourceStatus;路由 sources POST 收 {type,name,config}(兼容旧 {name,jwksUrl}→jwks);前端 SettingsView 源加类型选择器(JWKS/Static)+static kid/DER 字段条件切换+校验策略折叠(iss/aud/roles 可选)+源列 type/status 双徽标(lastError 悬浮)+信任密钥显示 sourceName。6 新 M2 测(static 源内联公钥物化+验签交换+源 healthy/**aud 不匹配 403 匹配放行**/**role 不在 allowedRoles 403**/**iss 不匹配源策略 403**/身份 claims email+given_name+role 随交换透传且入换发令牌/jwks 拉失败 status=error+lastError 含 500 不抛垮建源)→instance-trust 17 测全绿;**真实活体验证**(API：POST static 源带 aud+role 策略→{type:static,status:healthy}+物化信任密钥 sourceName→DELETE 204 清理;UI：Settings→Instance Trust 源列 live-m2-check[STATIC][HEALTHY]/self-loopback[JWKS][PENDING] 彩色徽标+类型选择器切 Static 换出 kid/DER 字段+校验策略段渲染,控制台零报错);全量 901 测通过。**P10 收官——#44–#47 全部完成。**

## P11 · Core Node 补差（节点库骨架缺口，来源：2026-07-22 n8n 2.30.4 面板全目录对照）

> n8n 面板 Core Nodes 共 53 个，nomops 已覆盖 19（#5/#6 批次 + 基础节点），缺 34。这 34 个是任何工作流都可能用到的平台骨架，逐个对照见 `docs/node-catalog-gap.md`。按批次粒度拆为 #48-54，优先级由高到低。app 集成（355）与 AI/RAG（101）不在此节，走独立框架/排期。

- [x] **48. 数据变换六件套：Sort / Limit / Remove Duplicates / Rename Keys / Summarize / Compare Datasets** `M/L` ✅ 2026-07-31（新增六个声明式纯内存节点：Sort 多字段/自定义序、Limit 首尾截断、Remove Duplicates 全字段/指定字段/排除字段且可保留首末、Rename Keys 深路径+受限正则、Summarize 分组 sum/avg/count/concat、Compare Datasets 双输入同/异/仅左/仅右四路；共享稳定序列化与字段路径工具，跨执行去重按条目约定后置；新增 16 节点单测 + 1 无 HTTP/DB 真实引擎四路拓扑测，六种引擎拓扑保持全绿，workflow 29/core 101/nodes 83/db 26/frontend 92/server 606、全量 937 测通过；真实 HTTP 回环验证六节点元数据与 Compare 四路执行输出，`pnpm dev` 启动通过，生产 UI 验证数据变换分类自动上架、`diff datasets` 别名搜索、fixedCollection 参数控件，基线 v2.31.0 同视口截图并排比对且最终控制台零报错；commit `bdd5733`）

- [x] **49. 日期/加密/文本格式五件套：Date & Time / Crypto / HTML / XML / Markdown** `M/L` ✅ 2026-07-31（新增五个声明式数据变换节点：Date & Time 支持 ISO/自定义/Unix 解析、格式化、加减与 IANA 时区，Crypto 支持 SHA/HMAC/Base64/UUID 及 scrypt+AES-256-GCM 对称加解密，HTML 支持 CSS 选择器提取与转义安全的文本转 HTML，XML 支持 JSON 双向转换并拒绝 DTD/实体声明，Markdown 支持 md↔html；输出路径统一拒绝原型污染段，新增 12 节点单测覆盖闰日/DST、Unicode 编码、错误密钥和 XML 实体边界，workflow 29/core 101/nodes 95/db 26/frontend 92/server 606、全量 949 测通过；`pnpm build` 6/6、`pnpm dev` 前后端启动通过，真实 HTTP 串联五节点执行成功，生产 UI 验证数据变换分类自动上架、`timezone` 别名搜索与 Date & Time NDV，基线 v2.31.0 同视口截图并排比对且干净标签控制台零报错；commit `c3a6c69`）

- [x] **50. 文件 IO 六件套：Read/Write File / Extract from File / Convert to File / Compression / FTP / Edit Image** `L` ✅ 2026-07-31（新增六个声明式文件节点：本地读写以 `NOMOPS_FILES_ROOT` 约束相对路径并拒绝穿越/符号链接，CSV/JSON/XLSX/PDF/Text 双向格式处理，ZIP/GZIP 压缩解压含条目数与解压体积上限，FTP/SFTP 上传/下载/列目录且凭证明文不进错误，Sharp 缩放/裁剪/文字水印；新增 15 节点单测 + 1 无 HTTP/DB 真实引擎文件回环测 + 1 binary 级联 GC 测，六种引擎拓扑与 schema parity 保持全绿，workflow 29/core 101/nodes 110/db 26/frontend 92/server 608、全量 966 测通过；`pnpm build` 6/6、`pnpm dev` 前后端启动通过，真实 HTTP 完成 items→JSON→磁盘写读→提取→CSV→ZIP 回环、真实 FTP 上传下载列目录与图片产物下载，生产 UI 验证六节点自动上架及 Convert to File NDV，基线 v2.31.0 同视口截图并排比对且 nomops 干净标签控制台零报错；commit `c6ab6b0`）

- [x] **51. 远程执行 + 邮件三件套：SSH / Send Email / Email Trigger (IMAP)** `M/L` ✅ 2026-07-31（新增三个声明式节点：SSH 支持密码/私钥、SHA256 主机指纹、命令执行与 SFTP 上传下载，Send Email 与服务通知复用同一安全 SMTP 客户端，Email Trigger 以 projectId 归属凭证注入、UID 游标/去重、MIME 解析轮询启动工作流；新增 6 节点协议单测 + 1 server 端到端触发测试，覆盖 SMTP/IMAP 真实协议、SSH 操作、明文/Base64 密钥不进错误/API/DB，workflow 29/core 101/nodes 116/db 26/frontend 92/server 609、全量 973 测通过；`pnpm build` 6/6、`pnpm dev` 前后端启动通过，真实 HTTP 完成本机 SSH 容器 stdout 回读、假 SMTP 投递抓包、假 IMAP 拉信触发执行，生产 UI 验证三节点元数据自动上架，基线同内容视口 1280×633 截图并排比对且两侧控制台零报错；commit `0753423`）

- [x] **52. 触发器补全五件套：Form Trigger / Form / RSS Read / RSS Feed Trigger / SSE Trigger** `M` ✅ 2026-07-31（新增通用节点 webhook 与 SSE 流式触发契约，Form Trigger 生成 CSP 安全公开表单并提交触发，Form 复用可序列化 contextData 实现流程内 HITL/多步恢复，RSS Read/Trigger 支持 RSS/Atom 解析与 processed_data 增量去重，SSE Trigger 真实长连接事件触发；新增 4 节点协议单测 + 4 server 端到端测试，workflow 29/core 101/nodes 120/db 26/frontend 92/server 613、全量 981 测通过；`pnpm build` 6/6、真实 curl 完成五节点往返、生产 UI 与基线 v2.31.0 同视口截图比对且 nomops 控制台零报错；commit `705de00`）

- [x] **53. 流程/工具杂项四件套：Stop and Error / Execution Data / TOTP / Git** `S/M` ✅ 2026-08-01（新增四个声明式节点：Stop and Error 主动抛出受控错误并进入 Error Trigger 工作流，Execution Data 读写当前执行可搜索 KV 元数据，TOTP 与 MFA 服务共享 RFC 6238 SHA1/SHA256/SHA512 实现，Git 在 `NOMOPS_GIT_ROOT` 沙箱内支持 clone/status/commit/pull/push、HTTPS token/SSH 密钥临时注入且禁用 hooks/file 协议；新增 7 节点单测 + 1 前端凭证类型测试，并扩展错误流/执行元数据/API 凭证明文不泄漏覆盖，workflow 29/core 101/nodes 127/db 26/frontend 94/server 614、全量 991 测通过；`pnpm build` 6/6、`pnpm dev` 前后端启动通过，真实 HTTP 完成错误流→handler、元数据详情、标准 TOTP 往返，临时 SSH Git 服务完成 clone→commit→push 且裸库内容一致；生产 UI 验证四节点元数据自动上架，与同镜像基线 2.31.5 在 1280×720 同视口并排比对，干净标签控制台零报错；commit `da59d5f`）

- [ ] **54. 自引用/低价值节点（评估后按需，默认不做）** `S~M`
  n8n / n8n Trigger（调 n8n 自身 API / 监听实例事件——nomops 等价物应改造为「nomops 自 API 节点」+ 实例事件触发，价值取决于是否需要工作流操作平台自身）、Data table（n8n 的内置数据表功能，需整套 dataTable 后端，属独立特性非单节点）、AI Transform（自然语言生成转换代码，依赖 AI 建流能力 #45）、Track Time Saved（n8n 云运营指标，自托管无意义）。
  → 逐项在开发前单独裁决；Data table 若做应并入独立特性立项，AI Transform 挂靠 #45，Track Time Saved 直接不做。

## P12 · 安全加固（来源：2026-07-25 benchmark-gap 对标审查 n8n 2.31.0，详见 `benchmark-gap.md`）

> 全局清单 🔴 必补里的安全踩坑集中在此，最高优先。多为「偏离了基线验证过的隔离/校验做法」的高危项；单租户自托管风险较低、多租户 Cloud 高危。

- [x] **55. 表达式引擎真隔离 + 超时** `L`（🔴 R1）✅ 2026-07-31（以 QuickJS/WASM 独立堆与全局域替换 `new Function` + 正则黑名单；作用域只经 JSON 深拷贝跨界，`$node`/`$input`/`$fromAI` 在隔离域内重建，不暴露宿主对象或函数；默认 5s/64MB/512KB 硬超时、内存与栈限制，Function 家族构造链及危险全局封锁，函数等不可序列化结果拒绝进入执行状态；新增 5 项拼接构造器/计算属性/死循环/内存耗尽/不可序列化回归，workflow 29 测、全量 906 测通过；构建产物活体验证正常求值 42、PoC 5ms 被拦、死循环 100ms 熔断且后续仍返回 42，`pnpm dev` + `/healthz` 通过；commit `37708ea`）

- [x] **56. HTTP 出站 SSRF 防护（连接期真实 IP 校验）** `M`（🔴 R2）✅ 2026-08-01（workflow 新增用户可控/固定目标信任标记；core 基于 Undici 自定义 `lookup` 在预解析与真实连接期双重校验 IP，拦截 RFC1918、回环、`169.254`、IPv6 ULA/映射地址，并对每次重定向重新建连复验、跨源移除认证头，HTTP/SSE 共用安全传输；6 个用户 URL 节点显式启用严格策略，固定内部调用保持兼容；新增 7 项 core 安全回归 + 1 项节点标记测试，全量 999 测、`pnpm build` 6/6 通过；真实 API 往返验证 metadata 与公网重定向内网均被拒、公网请求成功，`pnpm dev` + `/healthz` 通过；commit `b3ac25a`）

- [ ] **57. 社区节点安装加固（供应链）** `M`（🔴 R3）
  踩坑·高危：`packages/server/src/services/community-node-service.ts:49` `npm install` **无 `--ignore-scripts`** → 恶意/抢注包 pre/postinstall 安装期即宿主 RCE；且 `:130` 动态 import 进程内注册。
  → 安装加 `--ignore-scripts`；补包名/版本/checksum 预检 + 静态扫描（禁 `eval`/`Function`/`child_process`、import 白名单）+ 未验证包开关；长期把社区节点执行移出主进程。
  验收：含 postinstall 的恶意包安装不执行脚本；静态扫描命中禁用 API 拒绝安装。

- [ ] **58. 加密密钥外置 + 信封轮换** `M`（🔴 R4）
  踩坑·高危：`packages/server/src/bootstrap.ts:84` 密钥存 DB settings 表（无 env 覆盖），`packages/core/src/encryption/cipher.ts:7` 单 DEK 无 keyId → 密钥与密文同库，DB dump 同泄；换密钥即全量密文不可解。基线明言「第一天就按信封设计」。
  → 加 `NOMOPS_ENCRYPTION_KEY` env/文件来源（与库内不一致时报错，把密钥挪出库）；密文加 `keyId:` 前缀 + DEK 信封包裹，打开轮换路径。
  验收：密钥不在 DB；轮换后旧密文仍可解、新密文用新钥。

- [ ] **59. 恢复 URL GET 预览防误触** `S/M`（🔴 R5，#15 安全加固）
  踩坑·高危：`packages/server/src/controllers/index.ts:2933` `router.all('/webhook-waiting/...')` 对 GET/HEAD 立即 `executions.resume()`，无 isbot/UA 过滤。#15 场景就是把 `$execution.resumeUrl` 发进邮件/IM，链接预览/SafeLinks 扫描器一次 GET 即「批准」挂起流并耗尽一次性令牌 → 真人再点得 404。
  → webhook-waiting 只对 POST 执行副作用；GET 返回仅渲染「确认恢复」按钮的空 200 页（不触发 resume）；HEAD/已知 bot UA 直接空 200 短路。（与 #71 的 Webhook 深化可合并交付）
  验收：预览 bot GET 不触发 resume、不耗令牌；人点确认按钮 POST 才恢复。

- [ ] **67. 账户/会话安全四项** `M`（🟠 A7）
  中危集合：①`auth-service.ts:194` 改密/重置口令不吊销存量会话（被盗 JWT 存活至 7d TTL，§1 头号对标点）；②全仓无登录/MFA 限流（口令与 6 位 TOTP 可无限猜）；③`mfa-service.ts:104` `mfaSecret` 明文入库（DB 泄露即可复算有效码）；④`rbac.ts:49` `tierForScopes` 把自定义角色 scope 集塌缩成 viewer/editor/owner 三档 → 勾单 scope 越权到同档全部动作。
  → tokenVersion 吊销会话（改密/重置递增）；登录/MFA IP+账号双层限流；MFA secret 加密落库；自定义角色改逐 scope 校验。
  验收：改密后旧 token 401；暴破被限流；DB 里 mfa_secret 密文；勾单 scope 不越权到同档其他动作。

## P13 · 节点平台地基（解锁 P11 与集成规模化，来源同上）

> 🔴R6 是整个 P11 节点扩张的前置地基（3 个域独立点名）；本节多为「加节点/集成能规模化」的公共能力，应在大批量手写节点前落地。

- [x] **60. 动态节点参数层（loadOptions / resourceLocator / fixedCollection）** `L` ✅ 2026-07-31（workflow 声明契约补齐 `loadOptions`/`loadOptionsMethod`/`loadOptionsDependsOn`/`resourceLocator`/`fixedCollection`，server 新增 projectId 归属约束的凭证代查端点且错误统一脱敏，前端 ParamInput 元数据驱动实现动态下拉、三模式资源定位与可增删排序固定集合；新增 4 server + 3 frontend 测，workflow 29/core 101/nodes 65/db 26/frontend 87/server 605、全量 913 测通过；真实 HTTP 回环验证凭证解密→远端资源列表且响应无明文，基线 v2.31.0 同尺寸截图并排比对、生产控制台零报错；commit `a562fe0`）

- [x] **61. 节点面板/控件元数据驱动（清前端特判）** `M` ✅ 2026-07-31（workflow 节点描述新增 `categories/subcategories/aliases/hidden` 与真 `filter`/`assignmentCollection` 参数类型；NodePanel 移除类型名分类/隐藏特判，按 description 元数据分组、别名搜索并自动上架；ParamInput 仅按参数 type 分发条件构建器与赋值集合，普通 collection 回落 JSON；全量内建节点补齐分类元数据，Sticky Note 声明隐藏；新增 2 NodePanel + 3 ParamInput + 2 节点元数据测试，workflow 29/core 101/nodes 67/db 26/frontend 92/server 605、全量 920 测通过；真实 API 回环确认 Filter/Set/Switch 类型与分类，生产构建 UI 验证分类抽屉、`edit fields` 别名、两类控件，基线 v2.31.0 同视口截图并排比对且 nomops 控制台零报错；commit `68d0f4c`）

- [ ] **62. 声明式 routing DSL 增强（分页 + 收发变换）** `M/L`（🟠 A2）
  缺能力：`packages/workflow/src/interfaces.ts:159 IHttpRequestDeclaration` 仅 method/url/qs/body/headers；`routing-executor.ts` 无分页/postReceive/preSend/二进制 → SaaS 节点凡翻页/响应转换都退回写 `execute()`，拿不到声明式的规模化红利。
  → DSL 扩 `pagination` 描述符 + `postReceive`/`preSend` 变换钩子 + 二进制下载。
  验收：一个声明式节点能翻页聚合、能变换响应体、能下载二进制。

- [ ] **63. 凭证注入 DSL 完善** `M`（🟠 A3）
  缺能力/踩坑：`routing-executor.ts:97` 仅 header/query/path 桶；`integrations.ts:20` credentialInjection 绑**节点**非**凭证类型**（每节点各写一遍）；无函数式 authenticate；前端 `credential-types.ts:108` 声明的 PKCE/clientCredentials/digest/oauth1 后端不兑现（悬空能力，误导用户建不工作的凭证）。
  → 注入模板上移到凭证类型（一次声明处处复用）+ 补 body/basic 桶 + 可选函数式 authenticate；未实现选项要么实现要么从 UI 摘除。
  验收：digest 或 clientCredentials 凭证可真实工作，或 UI 不再暴露不可用选项；同类凭证注入声明只写一处。

- [ ] **75. usableAsTool 自动派生工厂** `M`（🟢 G1，低垂高杠杆）
  抢跑机会：ai_tool 端口 + `$fromAI`（#19）原语已就位（`AiAgent.node.ts:45`、`from-ai.ts`），但无自动派生机制，仅 `HttpTool` 手写单点。基线靠 `usableAsTool` 把 260 个存量节点免费变 Agent 工具——竞品最难复制的护城河。
  → `INodeTypeDescription` 加 `usableAsTool?: boolean`，loader/manifest 层 `convertNodeToAiTool` 克隆节点描述为输出 ai_tool 的 `*Tool` 变体（复用现有 supplyData 通道）。
  验收：置位的存量节点（8 集成 + HttpRequest）在 AiAgent Tool 端口可挂载并被调用。

## P14 · 引擎/运行时健壮性（来源同上）

- [ ] **64. OAuth2 多实例 + 刷新并发锁** `M`（🟠 A4）
  踩坑：`packages/server/src/services/oauth2-service.ts:29,75` 进程内 pending Map（queue/多实例下 auth 与 callback 落不同进程→连接失败）；`:130` 刷新无 dedup/锁（多 worker 同刷一 token，轮换型 provider 双刷竞态互相作废 refresh_token）。nomops 已有 BullMQ queue = 真实生产隐患。
  → pending state 落 Redis/DB（TTL 读即销毁）+ 刷新进程内合并 + Redis/DB 租约锁。
  验收：queue 模式下 Connect 与刷新不因进程亲和性失败、不双刷作废。

- [ ] **65. AbortSignal 贯通取消/超时** `M`（🟠 A5）
  踩坑：全域无 AbortController，`packages/core/src/execution-engine/workflow-execute.ts:438` 注释自陈「被抛下的 promise 仍在后台跑」——取消/超时只让引擎不再等，节点内在飞 HTTP 仍跑完，侵蚀实际并发余量。
  → AbortSignal 经 `additionalData.httpRequest` 贯通到 `defaultHttpRequest` 的 fetch，cancel()/超时即 abort 网络 I/O。
  验收：取消卡在慢 HTTP 的执行时底层请求被中断。

- [ ] **69. Agent 循环引擎化（V2→V3）** `XL`（🟠 A9，战略）
  踩坑·战略：`packages/nodes/src/nodes/AiAgent/AiAgent.node.ts:86-98` 是节点内 `while` 内联循环、`tool.invoke()` 直调，工具非真节点入引擎；且画布 agent 与 `instance-ai-service.ts:146` 两套循环割裂。停在基线 V2，工具调用不白嫖引擎重试/取消/HITL/观测；画布 agent 永远拿不到 HITL。基线全篇最核心情报「跳过 V2 直接 V3」。
  → 工具调用打包成引擎请求、由 workflow-execute 主循环调度工具节点、Agent 以 resume 恢复，画布/助手统一一套引擎化循环。
  验收：画布 AiAgent 工具调用可被取消/挂 HITL/在执行详情逐调用观测。

- [ ] **72. 发布 outbox + waitTill 索引 + WaitTracker 门控** `M`（🟠 A12，承接 #40）
  踩坑：无 `workflow_publication_outbox`（#40 明注 deferred）→ 多实例发布/激活事件最终一致无兜底；`packages/db/src/schema/pg.ts:734` executions 仅 `(workflow_id,created_at)` 索引，`wait-tracker.ts` 每 10s `findDueWaiting` 全表顺扫；WaitTracker 未 leader 门控（`bootstrap.ts:340` 对所有 main start），与 resume `409` 状态守卫间有 TOCTOU 双唤醒窗口。
  → 补 outbox 表 + 收尾投递 worker；加 `(status,wait_till)` 部分索引；WaitTracker 加 leader 门控或 DB compare-and-set。
  验收：多实例发布不丢激活；大执行表唤醒不全表顺扫；同一 waiting 不被双恢复。

- [ ] **73. License 吊销 + 配额原子化** `M`（🟠 A13）
  缺能力/踩坑：`packages/server/src/ee/license/license-service.ts:108` `activeCert()` 只查时间窗，`payload.id` 标注「吊销用」却无消费 → 退款/泄露只能等过期或轮换公钥（废所有证书）；`quota-service.ts:78` 执行配额 check-increment 有竞态，queue 多 worker 稳定超发。
  → cert-id 黑名单经 `/internal` 桥从控制平面下发、`activeCert()` 增查；执行配额原子自增（`ON CONFLICT … RETURNING` 后比对上限 / Redis 原子计数）。
  验收：吊销的证书立即失效；queue 多 worker 不超发配额。

## P15 · 前端/表达式/激活体验（来源同上）

> 2026-08-01 补充交付（用户直接 UI 任务，无新增编号）：画布节点本体按本地基线实测对齐（96px 卡片、48px 图标、16px 主端口、外置 16px/500 标签、触发器轮廓、6px 中性选中环）；新增 2 项组件回归，生产构建与全量 1001 项测试通过，隔离生产实例同视口复验且控制台零 warning/error。

> 2026-08-01 UI 反馈修复（无新增编号）：Overview/Personal/团队项目页资源 Tab 因 overflow 高度坍缩仅剩 14px 横条，现锁定 42px 可见高度并保留窄屏横向滚动；侧栏 New project 移除浏览器 `prompt()`，改为产品内 Modal。新增 4 项回归，生产构建 6/6、全量 1005 项测试通过；隔离生产实例复验五 Tab、Project settings、Modal 及干净控制台。

> 2026-08-01 UI 顺序改造第 0 项（全局基础）：新增统一 `UiDialog`（键盘焦点环、Escape/遮罩策略、移动端底部面板）、异步 `requestConfirm`、四态 Toast Host、`UiState` 空/加载/错误状态；全局挂载反馈 Host，New project 迁入公共 Dialog 并在成功后给出 Toast；补全全局 `:focus-visible` 与窄屏侧栏规则。新增 5 项组件回归，生产构建 6/6、全量 1010 项测试通过；后续页面按此基础逐页迁移，不再新增浏览器原生弹窗。

> 2026-08-01 UI 顺序改造第 1 项（认证页面）：抽取统一 `AuthFrame`，把登录、首装 owner、忘记/重置密码、邀请注册与 SSO 回调收敛为同一自托管认证视觉；补齐表单 label/autocomplete/autofocus、成功/错误可访问状态、强密码一致校验、MFA 初始焦点，并修正无效邀请回退公开注册与 SSO `/api/me` 非 2xx 仍建会话的问题。新增 4 项视图回归，生产构建 6/6、全量 1014 项测试通过；独立端口实测登录/注册/SSO 失败态且控制台零 warning/error。

> 2026-08-01 UI 顺序改造第 2 项（Overview / Workflows）：把新建文件夹、数据表、标签管理、移动、共享与授权提示六类页面私有弹层迁入统一 `UiDialog`，删除文件夹/标签/工作流/凭证/数据表及跨项目移动全部使用产品内确认框；资源移动、共享、复制、归档、恢复、删除和 MCP 授权补齐 Toast 反馈。新增 2 项布局回归，生产构建 6/6、全量 1016 项测试通过；浏览器实测五个资源 Tab、弹窗自动聚焦和关闭流程正常。

> 2026-08-01 UI 顺序改造第 3 项（Credentials）：类型选择与三 Tab 编辑器迁入统一 `UiDialog`，获得焦点圈、Escape、焦点恢复和移动端底部面板；删除凭证改用产品内引用影响确认，保存/创建/共享/删除补齐 Toast；连接测试升级为自动测试加载态与成功/失败状态条（含 Retry），类型搜索自动聚焦，帮助入口改为真实文档链接，列表空态用主题 SVG 取代系统 Emoji。新增 3 项组件契约回归，生产构建 6/6、全量 1019 项测试通过；浏览器实测类型搜索、编辑器三 Tab、表达式入口和关闭流程正常。

> 2026-08-01 UI 顺序改造第 4 项（Executions）：全局列表的单条/批量删除与批量停止增加产品内确认，停止、重试、删除补齐 Toast，并修正删除失败仍从列表乐观移除的问题；空态区分“尚无执行”和“筛选无结果”，提供清除筛选入口，批量操作条适配窄屏。执行详情删除增加确认与失败反馈，评分按钮由系统 Emoji 换为可访问主题 SVG，头部和标注区支持窄屏换行。新增 4 项视图契约回归，生产构建 6/6、全量 1023 项测试通过；浏览器实测默认空态、状态筛选空态和清除筛选流程正常。

> 2026-08-01 UI 顺序改造第 5 项（Variables / Data tables）：变量创建/保存/删除补齐 Toast，删除前说明 `$vars` 引用影响，引用代码支持一键复制，空态用主题 SVG；数据表详情新增加载/致命错误/操作错误/空表/搜索无结果状态，重命名迁入 `UiDialog`，表/列/行删除迁入产品内确认，各项写操作补齐反馈并适配窄屏工具栏。尚无导入实现的 CSV 选项明确禁用并标注 Coming soon，避免误导。新增 5 项视图契约回归，生产构建 6/6、全量 1028 项测试通过；浏览器实测变量空态、数据表空态和创建弹窗禁用状态正常。

> 2026-08-01 UI 顺序改造第 6 项（Projects / Shared）：Projects 页把页头常驻名称输入改为 `UiDialog` 创建流，加载/失败/空态分离，成员新增、角色变更、移除补齐反馈且移除前说明访问影响；表格与成员区适配窄屏。Shared 页不再把请求失败伪装成空列表，新增加载/错误/重试状态，Create workflow 改为真正创建并进入编辑器，移除无行为的 Update filters 链接并补齐移动端行布局。新增 5 项视图契约回归，生产构建 6/6、全量 1033 项测试通过；浏览器在登录态过期条件下实测两页错误态与重试入口正常。

> 2026-08-01 UI 顺序改造第 7 项（Canvas / NDV）：工作流描述、Workflow settings 与 URL 导入统一迁入 `UiDialog`，彻底移除浏览器原生 URL 输入框；归档工作流与删除测试运行改用产品内确认，设置、描述、导入、复制、归档等动作补齐 Toast。节点编辑器升级为可访问对话框，支持 Escape 关闭、Tab 焦点循环、关闭后焦点恢复、语义化 SVG 关闭按钮，并为窄屏提供三栏横向浏览。新增 5 项视图契约回归，生产构建 6/6、全量 1038 项测试通过；浏览器登录态已过期，未伪造在线画布数据，交互由类型检查与组件契约覆盖验收。

> 2026-08-01 UI 顺序改造第 8 项（Chat / Agents）：Chat 会话与 Personal agent 删除增加产品内影响确认及成功/失败反馈，系统字符关闭按钮替换为带可访问名称的主题 SVG；尚未接入操作的 Tools 控件明确禁用并解释能力边界。Agents 的 agent、定时任务、文件、渠道删除及 Instance Assistant 的线程、检查点恢复、MCP 断开全部迁入产品内确认，关键写操作补齐 Toast，列表补加载/错误/空态，两套复杂管理页补窄屏重排。新增 5 项视图契约回归，生产构建 6/6、全量 1043 项测试通过。

> 2026-08-01 UI 顺序改造第 9 项（Templates / History / Insights）：模板画廊区分加载、请求失败、服务端无模板与筛选无结果，提供重试/清筛选入口及导入成功反馈；版本历史不再吞掉版本/发布时间线错误，补全整页加载/失败/空态、键盘可选版本行和有效 Upgrade 导航，发布旧版本前明确提示会覆盖当前改动，克隆/下载/恢复均有反馈；Insights 统一加载/失败/空数据状态和重试入口，KPI 与图表适配窄屏。新增 5 项视图契约回归，生产构建 6/6、全量 1048 项测试通过。

> 2026-08-01 UI 顺序改造第 10 项（Settings / Admin / Audit）：Settings 中部署密钥、信任源、动态凭证解析器、API Key、社区节点、自定义角色、用户、许可证与源码同步等高影响操作全部迁入产品内确认并补反馈；MCP workflow 描述从浏览器 `prompt()` 迁入 `UiDialog`。新增全局 `requestInput`/`UiInputHost`，统一画布节点工具条与右键菜单的 Rename 流；AI Builder 最后一个原生确认同步迁移，生产前端不再包含浏览器原生 `confirm/prompt/alert`。Admin 与 Audit 补齐加载/致命失败/空态/重试及表格窄屏滚动。新增 6 项视图契约回归，生产构建 6/6、全量 1054 项测试通过；最终浏览器复验时原登录态已失效，提供的账号口令返回 Invalid email or password，未绕过认证伪造数据。

> 2026-08-01 UI 顺序改造第 11 项（AI Builder）：修复 `/builder/:id` 深链仅声明路由却不选中会话的问题，列表选择同步 URL；会话列表、详情、对话和草稿预览补齐加载/错误/空态及重试，版本恢复增加影响确认并与新建、应用工作流、丢弃会话统一 Toast，关闭字符替换为可访问 SVG。三栏在平板重排、手机纵向堆叠。新增 5 项视图契约回归，生产构建 6/6、全量 1059 项测试通过。

> 2026-08-01 UI 顺序改造第 12 项（全局 Shell / 导航）：补齐 Agents、AI Builder、Assistant、Data table 与 SSO 完成页的浏览器标题；应用外壳增加跳转主内容链接、main landmark 和路由读屏播报；侧栏修正画布误高亮 Overview，当前项统一 `aria-current`，图标按钮、折叠菜单补齐可访问名称与展开状态；命令面板按 dialog + combobox + listbox 语义接线。新增 5 项视图契约回归，生产构建 6/6、全量 1064 项测试通过。

> 2026-08-01 UI 顺序改造第 13 项（全局响应式 / 可访问性终审）：全量扫描生产 Vue，清除浏览器原生对话调用、`href="#"` 伪链接及字符式关闭按钮；登录、画布、聊天与设置的页内动作改为语义按钮，节点面板、数据表、画布标签/Focus panel、文件夹/标签、固定集合和 Toast 统一为带可访问名称的 SVG 控件；许可证、About、What's New 迁入 `UiDialog`，剩余 Settings 弹窗补齐 dialog 语义与名称。新增 5 项全局审计回归，生产构建 6/6、全量 1069 项测试通过；浏览器复验公开登录页的语义按钮与视觉正常，登录后页面仍受已记录的账号口令失效限制。

> 2026-08-01 UI 顺序改造第 14 项（命令面板 / 全局搜索）：修复“新建凭证”未打开创建弹窗、“打开凭证”只进入列表及 Data tables 使用错误 Tab 参数的问题，Overview 支持凭证 ID 深链并在关闭后清理一次性查询参数；命令资源每次打开刷新，加载失败不再伪装成无结果，补齐加载/错误/重试/无匹配状态。键盘选择首尾循环并自动滚入视野，对话焦点循环且关闭后恢复触发点；工作流创建补齐成功/失败反馈。新增 5 项视图契约回归，生产构建 6/6、全量 1074 项测试通过。

> 2026-08-01 UI 顺序改造第 15 项（Chat / Agents / Assistant 深层状态）：三个 AI 工作区不再将会话、版本、记忆、任务、文件、渠道、运行树、MCP 与模型提供方的请求失败伪装为空数据，统一补齐深层加载、失败与重试状态；Assistant 记忆检索区分进行中、失败和无匹配，渠道切换、动作拒绝、工作流应用、个人 Agent 保存与文件下载补齐成功/失败反馈。新增 5 项视图契约回归，生产构建 6/6、全量 1079 项测试通过。

> 2026-08-01 UI 顺序改造第 16 项（页面路由与最终验收）：移除与 Stateful Assistant 可选参数路由冲突的旧 `/assistant → /chat` 重定向，确保侧栏进入、地址直达和刷新始终落到同一 Assistant 页面；新增所有顶层 View 路由覆盖、命名页标题、公开路由边界、Assistant 解析与旧资源跳转 5 项回归。生产构建 6/6、全量 1084 项测试通过；浏览器实测公开登录表单语义及 `/assistant`、`/agents`、`/chat` 未登录守卫均正常。

> 2026-08-01 UI 顺序改造第 17 项（画布节点执行态专项）：修复执行详情使用 `ok` 而节点样式仅识别 `success` 导致成功态丢失的问题，实时运行与只读快照统一状态模型；节点新增 n8n 式运行中、成功、失败角标（含减弱动画设置），disabled 快照复用禁用视觉，工具条与快捷新增图标按钮补齐可访问名称。新增 3 项节点回归，生产构建 6/6、全量 1087 项测试通过。

> 2026-08-01 UI 顺序改造第 18 项（画布上下文菜单专项）：节点右键菜单与悬浮工具条统一 Execute step 能力判断，模型/记忆子节点不再展示无法执行的入口；将已有 Pin data 能力接入右键菜单，支持执行后 Pin 与已 Pin 节点 Unpin，并隐藏能力子节点不适用入口。画布、便签和节点菜单补语义名称，Escape 可统一关闭。新增 4 项画布回归，生产构建 6/6、全量 1091 项测试通过。

> 2026-08-01 UI 顺序改造第 19 项（画布连线交互专项）：连线透明命中区升级为可聚焦、可命名的键盘入口，Enter、Space 与点击/触摸均可稳定打开中点操作；中点操作建模为 Connection actions 工具条，焦点进入时保持可见，插入节点与删除连线图标按钮补齐独立名称，连线获得可见焦点反馈。新增 4 项连线回归，生产构建 6/6、全量 1095 项测试通过。

> 2026-08-01 UI 顺序改造第 20 项（节点选择器专项）：节点类型目录新增独立 loading/error/retry 状态，接口失败不再伪装成空分类或阻断画布本体加载；区分实例未注册节点与搜索无结果，搜索无结果可一键清除。面板与搜索框补语义名称，支持 Escape 关闭、焦点恢复、Arrow/Home/End 循环浏览及搜索框向下进入列表。新增 6 项节点面板与 store 回归，生产构建 6/6、全量 1101 项测试通过。

> 2026-08-01 UI 顺序改造第 21 项（Focus panel 专项）：右侧入口补齐 aria-expanded/controls 并关联命名面板，Escape 关闭后恢复入口焦点；Focus panel 与节点选择器改为互斥，杜绝两个右侧抽屉重叠。无钉选参数时使用统一空状态，说明从节点编辑器 Pin parameter 的下一步。新增 4 项画布回归，生产构建 6/6、全量 1105 项测试通过。

> 2026-08-01 UI 顺序改造第 22 项（画布 Chat / Logs 底栏专项）：拆除 Chat disclosure 内嵌 New session 按钮的无效 HTML，两个标题入口以 aria-expanded/controls 关联同一底部面板；将伪称独立视图的 Logs popout 改为诚实的 Expand logs。Chat 与 Logs 成为命名 region，空态统一，等待响应可播报；节点日志选择补 pressed 状态，Input/Output 接入 tablist/tabpanel 语义，新会话提供反馈。新增 5 项画布回归，生产构建 6/6、全量 1110 项测试通过。

> 2026-08-01 UI 顺序改造第 23 项（画布主操作区专项）：Add first step、Execute 与 Stop 的系统字符替换为主题 SVG；多触发器选择入口补 expanded/controls 并关联命名 menu，选项使用 menuitemradio/checked，Escape 可关闭。运行失败升级为 alert；右侧 Canvas tools 工具条及节点、命令、便签图标入口补齐名称，命令入口声明打开 dialog。新增 5 项画布回归，生产构建 6/6、全量 1115 项测试通过。

> 2026-08-02 UI 顺序改造第 24 项（登录态视觉验收修正）：复用 Chrome 有效登录态完成最终验收，覆盖 Overview 五个资源 Tab、产品内 New project Dialog、真实工作流画布、节点选择器、Chat、Agents、Assistant、Projects、Settings，以及 Credentials / Executions / Variables / Data tables，页面均无加载错误。验收发现 AI Agent 的 Chat Model / Tool / Memory 底部端口标签互相重叠并压住节点名称；首尾标签改为向外锚定，中间标签错层，含 AI 能力输入的节点为名称预留独立垂直空间，浏览器复验通过。新增 1 项节点回归，生产构建 6/6、全量 1116 项测试通过。

- [ ] **66. 执行可视化正确性（串台 + 重连 + 频道）** `M`（🟠 A6）
  踩坑：`packages/frontend/src/stores/execution.ts:44` handleEvent 不按 executionId 过滤（并发执行/多用户高亮串台）；`packages/server/src/ws/push-hub.ts:27` 广播全连接无 workflow 频道；`execution.ts:38` WS 断线不重连（静默丢实时进度）。三者叠加使执行可视化在任意并发/断网下失真。
  → handleEvent 首行按 executionId 过滤（executionStarted 除外）；push-hub 按 workflowId 分频道；WS 加指数退避重连 + 心跳。
  验收：并发执行/多用户/断网下画布高亮不串台、断线自恢复。

- [ ] **68. displayOptions 版本门控 + 操作符** `M`（🟠 A8）
  缺能力：`packages/frontend/src/lib/display-options.ts:8-32` 仅 `includes()` 等值，无 `_cnd`（gte/lte/between/regex/exists）；`NdvModal.vue:180` 版本只被动注记不门控 → 无版本化参数面，节点演进即破坏存量工作流；且受控值为表达式时会被误隐藏。
  → `IDisplayOptions` 值支持 `{_cnd:{…}}` + `isPropertyVisible` 加 `@version` 门控 + 「受控值为表达式默认显示」分支。越早加改造面越小。
  验收：节点升版本参数按 typeVersion 正确显隐，存量工作流不破；表达式态字段不被误隐。

- [ ] **70. Luxon + 扩展方法 + 同构预览** `L`（🟠 A10/ 🟢 G2）
  缺能力：`grep luxon/DateTime/toDateTime` 零命中，`$now` 是字符串，0/108 扩展方法 → `{{ $now.plus({days:1}) }}`/`.isEmail()`/`arr.first()` 全报错，DX 与基线断层；前端 `ExpressionInput.vue` 未 import 引擎，无「预览即真值」（引擎在 workflow 包、天然可跑浏览器=抢跑窗口现成）。
  → 接 Luxon（$now/$today 改 DateTime）+ 首批高频扩展方法（AST 改写把 `x.method()` 路由到 `extend()`）+ `.doc` 元数据；把 `resolveParameterValue` 接进 NDV 做实时预览、补全按运行数据解析真实字段/方法、高亮加 pending 三态。
  验收：`$now.plus({days:1})`/`.isEmail()` 可用；NDV 表达式实时出真值预览。

- [ ] **71. Webhook 节点安全深化** `M`（🟠 A11，含 #59 恢复 URL 加固）
  缺能力：`packages/nodes/src/nodes/Webhook` 仅 path+method → 生产 webhook 仅靠路径保密即可被任意触发；响应模式 2/6（缺 lastNode/streaming）；无动态 `:param` 路径段。
  → 补 Webhook 鉴权四档（none/basic/header/jwt）+ `ignoreBots` + responseMode=lastNode；`/webhook-waiting` 只对 POST 执行副作用（#59 合并）；动态 `:param` 与 streaming 可延后。
  验收：无鉴权 webhook 可加 header/basic 保护；预览 bot GET 不触发 resume；末节点答生效。

- [ ] **74. 删除桥接 + 模板凭证向导 + 空态 starter** `M`（🟠 A14）
  缺能力：`packages/frontend/src/stores/editor.ts:223` removeNode 只删+剥连线不桥接（删中间节点断链需手工重连）；`router.ts` 无 `/templates/:id/setup`（模板导入后无「需凭证→向导」分支，`template-registry.ts:19` setupHints 仅静态文字）；`OverviewView.vue:1013` 空态仅「Start from scratch」不露模板。
  → removeNode 单入单出 main 时自动接上游→下游；新增 `/templates/:id/setup` 凭证向导（按类型/名分组卡 + 无歧义自动填充 + 可跳过）；空态推 `branch-merge-demo` starter 卡（免凭证、导入即可手动跑）。
  验收：删中间节点自动重连；模板导入需凭证时进向导；空态一键落地可跑 starter。

- [ ] **76. 协同编辑地基（EPIC）** `XL`（🟢 G3）
  抢跑窗口：无 presence / 无写锁 / 无 CRDT（基线 Yjs 亦「已建未接」）。但 nomops 现状更靠后——`stores/editor.ts` 各 action 直写非 apply 收敛、undo 全量快照非命令式，直接上 CRDT 成本高；且当前 `save()` 末位写覆盖，并发编辑静默互相覆盖。
  → 分两步：先补保存乐观锁（workflow 加 version 列、save 带版本、后端 409 冲突提示而非覆盖，立即消除并发丢改）；同时把 editor store 重构为「public 方法 → 私有 applyXxx 唯一写入点」，为日后 CRDT/undo 命令化铺路。
  验收：并发编辑不静默互覆盖（409 提示）；状态写入收敛到单入口。

> **需单独裁决的决策点（非本批开发项，先记账）**：AI/RAG ~101 节点是否立独立 EPIC 编号（多模型 Chat Model 最高优先）；Code 节点 Python 是否排期；多人协作 presence 是否做（已并入 #76 地基）；`activeWorkflows` 是否作为计费维度（现按执行次数）；`appendAttribution` 病毒署名待自有域名上线再评估；helmet/CSP 安全响应头补法（部署层 nginx vs 应用层）。

---

## 不做 / 范围外（已裁决，勿重提）

- Desktop/Electron（已评估放弃）。
- B 类锁墙 6 项维持基线 1:1 阉割形态（Roles/Security & policies 等）——除非用户改裁决；Insights 例外已列 #8。
- Cloud 控制平面在独立仓库 `~/ByteMono/nomops-cloud`，不在本仓。
- Chat 附件/语音空按钮、凭证字段套用节点表达式控件（误导性假控件，见 gap-list）。
