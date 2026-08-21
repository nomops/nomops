# 15 — 可选实例支持集成

## 目标与边界

自托管 nomops 可以由管理员选择连接一个 nomops-site，在实例内向已登录成员提供“获取支持”。这是实例主动发起的服务端到服务端集成，不是 Cloud 控制平面：不包含 Cloud 注册、Cloud 登录、租户编排、实例代理、远程协助或站点控制实例。

nomops-site 只能接收显式提交的支持请求，不能从站点向实例发起请求，也不能访问实例的工作流、凭证、执行输入输出、日志、环境变量、数据库、文件、主机信息或用户 API Key。

## 配置

必须同时配置：

```bash
NOMOPS_SUPPORT_URL=https://support.example.com
NOMOPS_SUPPORT_TOKEN=nomops_support_<由站点运营后台一次性签发的高熵值>
```

- `NOMOPS_SUPPORT_URL` 是 nomops-site 基础 URL。服务端忽略其原路径、查询和 fragment，固定请求 `/api/instance/v1/tickets`，不会成为任意 URL 代理。
- `NOMOPS_SUPPORT_TOKEN` 是当前安装实例独立的 support client 凭证，只授权创建支持工单，不授予 Admin、客户/订阅查询或实例控制权限。
- 两者都存在时 `GET /api/support/status` 返回 `{ "enabled": true }`；任一缺失时只返回 `{ "enabled": false }`，且提交接口拒绝请求。
- 状态、健康检查和配置 API 永不返回 URL 或 Token。Token 不写入 nomops 数据库、浏览器、日志或错误消息，应通过部署平台的服务端 secret 管理能力注入。

站点轮换 Token 后旧值立即失效；先安全更新实例环境变量并重启服务。站点吊销客户端后，实例提交会得到稳定的“支持服务暂不可用”错误，而不会看到上游鉴权细节。

## 本地 API 与鉴权

实例提供：

- `GET /api/support/status`：需要现有登录会话，只返回是否启用。
- `POST /api/support/tickets`：需要现有登录会话；匿名请求和 API Key 请求不能代替交互式用户提交。

前端提交姓名、邮箱、主题、描述，并发送 8–128 位 `Idempotency-Key`。服务端以同一个键完成有限重试，自动添加当前 `NOMOPS_VERSION`（缺省为包版本基线）和 `EXECUTIONS_MODE` 对应的 `regular`/`queue`。不会自动收集或附加任何诊断数据。

上游 400、401、409、429、5xx、超时和网络错误会映射为稳定的本地错误码与脱敏消息；上游响应体、数据库错误、文件路径、堆栈、Authorization header 和运行配置不会转发给用户或写入日志。请求超时有限，不会无限等待。

## 出站网络安全

`NOMOPS_SUPPORT_URL` 属于可配置的出站目的地，使用 `packages/core/src/execution-engine/safe-http-request.ts` 的 `user-controlled` 信任级别：

1. 只允许 HTTP/S，禁止 URL 用户名和密码。
2. 请求前解析 DNS，并拒绝回环、RFC1918 私网、link-local、IPv6 ULA/映射私网及云元数据地址。
3. socket 连接时通过安全 lookup 再次校验实际连接 IP，防止 DNS rebinding。
4. 每个 redirect hop 都重新校验；跨源重定向会移除认证头。
5. 生产代码没有关闭该策略的开关。仅自动化测试可以显式注入本地 HTTP transport，用于真实回环服务验收。

因此，若 nomops-site 只在私网地址可达，当前安全策略会按设计拒绝。不要通过放松生产 SSRF 策略绕过；应为支持站点提供受 TLS 保护、可公开解析且由部署方控制的地址，或另行评审固定服务集成的网络信任模型。

## 数据最小化

允许出站的 JSON 字段只有：

- `requesterName`
- `requesterEmail`
- `subject`
- `description`
- `productVersion`
- `deploymentMode`（`regular` 或 `queue`）

页面必须持续展示安全提示：“请勿提交密码、API Key、Token、凭证明文、工作流敏感数据或未经脱敏的日志。”当前集成不支持附件、诊断包或日志自动上传。

## 运维验证

启用后先用普通登录成员提交不含秘密的测试工单，并在 nomops-site 运营后台核对：

- `source=nomops-instance`
- `priority=normal`
- `status=open`
- 产品版本与部署模式正确
- 相同 `Idempotency-Key` 不产生重复工单

随后验证错误 Token、吊销与轮换生命周期。任何测试 Token 都不应进入截图、Git、命令历史或日志；一次性展示页面离开后无法恢复，只能轮换。
