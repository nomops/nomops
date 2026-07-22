# nomops 功能开发待办清单（feature-backlog）

> 来源：2026-07-21 全项目缺口盘点（引擎/服务端/节点/前端四路代码审计 + diff-ledger + ui-audit gap-list 交叉）。
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

- [ ] **14. Chat 会话与个人 Agent 落后端** `M`
  现仅 localStorage，不跨设备。→ 会话/agent 表 + CRUD + 前端同步。

## P4 · 触发器与凭证深化

- [ ] **15. 匿名 resume webhook（waiting webhook）** `M`
  Wait 现只支持时间等待 + 鉴权 resume API；补公开恢复 URL（`resumeToken` 字段已预留），支撑表单审批类场景。

- [ ] **16. OAuth2 refresh token 自动续期** `S/M`
  refresh_token 已存储（`oauth2-service.ts:115`）但过期不自动刷新。

- [ ] **17. 重试从失败节点续跑** `M`
  现为全量重跑（`execution-service.ts:374` 注释自承）。用已有 partial-execution 机制从错误节点播种。

- [ ] **18. SMTP 邮件投递** `M`
  邀请/密码重置链接现只落服务端日志。→ SMTP 配置 + 邮件模板 + 发送通道（保留无 SMTP 时的日志回退）。

## P5 · 引擎/表达式深化

- [ ] **19. $fromAI + NDV「From AI」控件（D096）** `L`
  全仓零命中。引擎表达式变量 + AI Agent 运行时填参 + NDV Mapping|From AI 分段控件。

- [ ] **20. 表达式访问增强：$node 高级访问 / $input / $runIndex / $prevNode** `M`
  现 `$node` 只取 main 端口 0 首 item 的 `.json`（`evaluator.ts:27-37`）。

- [ ] **21. pairedItem 跨节点血缘解析** `M/L`
  现只在输入输出等长时按索引补齐；无血缘解析器（数据来源追溯的地基）。

- [ ] **22. binary 数据生命周期** `M`
  引用 GC/清理 + binary 走完整引擎的端到端测试。

## P6 · 平台能力面扩展

- [ ] **23. External Secrets 多 provider** `L`（现仅 env-var；补 Vault 优先，AWS/Azure/GCP 视需求）
- [ ] **24. Log Streaming 多 destination** `L`（现仅 webhook；补 syslog + 细粒度事件树，对齐 P2-6）
- [ ] **25. MCP OAuth 鉴权** `M/L`（现仅 access token；前端分段控件已画好）
- [ ] **26. Public API 独立面 + 细粒度 scopes** `L`（现 readonly/all 两档、复用内部 /api；API key Custom scopes 前端已画、提交降级 all）
- [ ] **27. OpenTelemetry 后端** `L`（现为零，前端整页本地态假表单；OTLP 导出 + 表单接线）
- [ ] **28. SCIM Groups** `M`（Users 已实现；Groups→projects 映射按 docs/07 延后项）
- [ ] **29. 自定义角色（custom roles）** `L`（现固定枚举；Roles 页锁卡）
- [ ] **30. lastActive 字段（D146）** `S`（加列 + 迁移 + 每请求打点 + API + 前端相对时间）

## P7 · Epic 级（独立立项，先规划再动工）

- [ ] **31. EPIC-EVAL 评测/测试子系统** `XL`
  dataset / eval trigger / test run / metric / 执行标注👍👎 / Debug in editor 全链，nomops 零后端。
- [ ] **32. Chat 多模态（附件）+ 语音 STT** `XL`
- [ ] **33. 凭证专属表达式模式** `M`（仅 `$secrets`/env 补全的专用控件，见 gap-list P2-4 收回记录）

---

## 不做 / 范围外（已裁决，勿重提）

- Desktop/Electron（已评估放弃）。
- B 类锁墙 6 项维持基线 1:1 阉割形态（Roles/Security & policies 等）——除非用户改裁决；Insights 例外已列 #8。
- Cloud 控制平面在独立仓库 `~/ByteMono/nomops-cloud`，不在本仓。
- Chat 附件/语音空按钮、凭证字段套用节点表达式控件（误导性假控件，见 gap-list）。
