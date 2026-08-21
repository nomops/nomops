# Nomops 自 API 节点与实例生命周期触发器

## 定位

这是一项可选的本实例自动化能力，不是 Cloud 控制平面，也不建立远程实例访问、实例注册、代理或控制通道。工作流只能主动调用它所在的 Nomops 实例。

## Nomops 节点

节点支持以下固定操作：

- Workflow：List、Get、Activate、Deactivate
- Execution：List、Get、Retry、Stop

节点必须选择 `nomopsApi` 凭证。该凭证只包含 `nmp_…` API Key，按普通凭证加密存储，明文不会从凭证 API 返回。建议在 Settings → API Keys 创建只包含所需资源和读写权限的最小 Scope Key，再在 Credentials 中保存。

执行时的安全链路：

1. 节点只提交枚举操作、资源 ID 和操作选项，不能提交 URL、任意 API path 或项目 ID。
2. server 固定目标为管理员控制的 `NOMOPS_BASE_URL`，固定追加 `/api/v1` 路径，并强制 `X-Project-Id` 为当前工作流执行项目。
3. 请求通过 `X-Nomops-Api-Key` 进入现有版本化 API。API Key scope、Key 所属用户的项目成员关系和 RBAC 都必须通过。
4. 目标是代码内固定服务集成，因此允许访问本实例的 loopback/private 地址；这不会放松 HTTP Request、Polling、SSE 或其他用户可控 URL 的 SSRF 策略。
5. 每次请求最多等待 30 秒，并继承工作流取消/执行超时信号。跨域重定向会剥离 `X-Nomops-Api-Key` 与 `X-Project-Id`。

API Key 不写入节点输出、执行数据、审计详情或错误上下文。正常 API 路由产生的审计仍以 API Key 所属用户和当前项目记账。

## Nomops Trigger

可选事件：

- `init`：进程启动后恢复已激活工作流
- `activate`：该工作流从未激活状态启用
- `update`：已激活工作流发布新版本并重注册触发器

生产触发输出只包含 `event`、`eventType`、`timestamp`、当前 `workflowId` 和 `workflowName`。它不订阅全局事件流，不读取或发送其他项目、其他工作流定义、执行输入输出、凭证、日志、环境变量或数据库配置。队列模式由 leader 注册并派发，执行仍走现有队列。

## 运维检查

- `NOMOPS_BASE_URL` 必须是无嵌入用户名/密码的 HTTP(S) URL，且在 queue worker 上能访问主 API。
- API Key 轮换或吊销立即按现有 API Key 生命周期生效；节点凭证需手动更新为新 Key。
- 为读操作优先使用 `workflow:read` / `execution:read`；只有需要激活、重试或停止时才增加对应资源的 `workflow:write` / `execution:write` API Key Scope。项目 RBAC 的写入/执行权限仍会另外检查。
- 如果 Key 用户不属于当前工作流项目，即使 Key 本身有效也会返回 403。
