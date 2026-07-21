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

- [ ] **5. 数据处理节点五件套：Switch / Filter / SplitOut / Aggregate / Loop(SplitInBatches)** `L`
  列表加工目前全靠 Code 节点手写。Switch 需引擎多输出已支持（If 即双输出）。

- [ ] **6. 触发配套三节点：Error Trigger / Execute Workflow Trigger / RespondToWebhook** `M`
  error workflow 后端链路已通（`fireErrorWorkflow`）缺专用起点节点；子工作流缺被调方触发器；Webhook 无法自定义响应体。

- [ ] **7. Google Sheets + Telegram 集成节点** `M`
  凭证类型已定义（`credential-types.ts`），用声明式 routing 工厂量产即可。注意 Telegram token 在 URL path，需扩展 credentialInjection 支持 path 注入。

## P2 · 现成后端的前端拆墙 / 接线

- [ ] **8. Insights 拆锁墙** `S/M`
  后端 `/api/insights` 完整（失败率/均耗时/趋势分桶），前端整页锁墙从不调用——与当年 Variables 墙同性质的拟态过度。
  → 前端接真数据渲染 5 指标 + 趋势；可选带上 D153 项目选择器。
  证据：`InsightsView.vue:5-8`、`api/client.ts:517-528`。

- [ ] **9. 设置页本地态字段接线** `M`
  填了不发送的字段贯通后端：OIDC Prompt/ACR/Additional scopes；LDAP loginLabel/userFilter/allowUnauthorizedCerts/sync 系列（含 Test/Run synchronization 按钮启用）；MCP redirect 白名单持久化。
  证据：`SettingsView.vue:166-171/257-281/539`。

- [ ] **10. 执行批量删除** `S`
  后端只有单条 DELETE；补批量端点 + 前端多选删除。

- [ ] **11. 台账遗留 UI 小项清扫** `S`
  D026 命令面板上下文徽标、D114 options 自定义下拉、panel-right 图标与 Focus Panel 联动、MCP 弹层 Configuration JSON（D143）、MCP workflows description 可编辑（D144）。

## P3 · 协作与归属（表结构已就绪）

- [ ] **12. 工作流/凭证共享（sharing）** `L`
  `shared_workflows`/`shared_credentials` 带 role 列但插入恒为 owner，无 shareWith 端点；前端 Share.../Sharing tab 现为锁卡。
  → 共享端点 + 权限语义（读/写）+ 前端 Share 弹窗替换锁卡。License 门控 `sharing`。

- [ ] **13. 工作流移动/转移** `M`
  「Move to 文件夹」入口恢复（`moveWorkflowToFolder` 死代码在 `OverviewView.vue:441`，需文件夹/项目选择弹窗）+ 跨项目 transfer 端点（含凭证归属校验）。

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
