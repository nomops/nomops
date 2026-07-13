# 08 — Phase 6c：执行配额 + 计费骨架

> 企业功能第三切片。核心交付是**按 project 的执行配额网关**（Cloud 计费的地基），
> 计费本体只做骨架（套餐/用量数据就位，支付集成留给选定服务商后的独立切片）。
> License 功能开关：`quotas`。

---

## 一、范围与边界

**做**
- 用量计数：每 project 每自然月的执行次数，独立计数表（billing-ready）
- 配额强制：执行入口（手动/webhook/cron）统一过配额网关，超额拒绝
- 套餐体系：内置 plan（free/pro/unlimited）+ 按 project 自定义上限
- 管理 API：实例 admin 派发套餐；project owner 查用量
- 前端：项目页展示用量/上限

**不做（留给后续）**
- 真实支付集成（Stripe/Paddle 等——需选型拍板，且无法本机验收）
- 按执行时长/数据量计费维度（先只按次数）
- 用量对账导出、发票

**社区版零回归**：无 `quotas` 功能 = 一切无限额，现有行为与测试不变。
企业版未派发套餐的 project 也默认 unlimited（自托管友好）。

---

## 二、套餐（代码内置，硬契约）

| plan | monthlyExecutions |
|---|---|
| `free` | 100 |
| `pro` | 10,000 |
| `unlimited` | null（不限） |
| `custom` | 按 project_quotas.monthlyExecutions |

---

## 三、数据模型增量（迁移 0003）

```typescript
// 每 project 的配额配置（无行 = unlimited）
export const projectQuotas = pgTable('project_quotas', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id),
  plan: text('plan').notNull(),                    // free|pro|unlimited|custom
  monthlyExecutions: integer('monthly_executions'),// custom 用；其余按 plan 表
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 用量计数（billing-ready；执行记录将来可清理，计数不受影响）
export const usageCounters = pgTable('usage_counters', {
  projectId: uuid('project_id').notNull(),
  period: text('period').notNull(),                // 'YYYY-MM'（UTC 自然月）
  executions: integer('executions').notNull().default(0),
  // 复合主键 (projectId, period)
});
```

---

## 四、配额网关

- **强制点唯一**：`ExecutionService` 创建 execution 记录前调
  `QuotaService.consume(projectId)`——手动/webhook/cron/queue 全走这一处。
- 超额行为：
  - 手动运行 / webhook → `429 { error, quota: { period, used, limit, plan } }`
  - cron 触发 → 跳过本次（不建 execution 行），`console.warn` 一次性提示
- 计数语义：**执行开始即计数**（含失败的执行——资源已消耗）。
- 并发说明：检查与自增之间存在小竞态窗口（极端并发下可能少量超发）。
  单实例部署可忽略；queue 多 worker 场景的原子化（DB 原子自增/Redis）列为已知边界。
- 社区版：`QuotaService` 直接放行（不计数也不查询，零开销）？
  ——**否**：计数照常（用量数据对社区版也有展示价值），只是不设限。

---

## 五、API

```
GET /api/projects/:id/usage          [project:owner]        { period, used, limit, plan }
PUT /api/projects/:id/quota          [quotas][实例 admin]    { plan, monthlyExecutions? }
```
- 审计动作：`quota.update`。
- 前端：项目页每行显示「本月用量 / 上限」（owner 可见）。

---

## 六、验收标准（全部单测）

- [ ] 上限 N 的 project：第 N 次执行成功，第 N+1 次手动运行 → 429 带 quota 详情
- [ ] webhook 超额 → 429；cron 超额 → 静默跳过（无新 execution 行）
- [ ] 不同 project / 不同月份计数互不影响；失败执行也计数
- [ ] plan 派发：free=100 生效；unlimited 不拦；custom 用自定义值
- [ ] 社区版：quota API 403 带 feature；执行永不被拦（照常计数）；零回归
- [ ] usage API：owner 可查，viewer/editor 403
- [ ] 双方言迁移 + schema parity
- [ ] 既有 142 测零回归

---

## 七、支付集成（后补：选型 = 支付宝）

**模型 = 订单式买时长**（支付宝周期扣款需商家特批协议，不做）：
`POST /api/billing/checkout {plan, months}` [project owner] → `billing_orders` 建单 →
返回 `alipay.trade.page.pay` 收银台 URL（RSA2 签名）→ 用户支付 →
支付宝异步 POST `/billing/alipay/notify`（form-encoded，RSA2 验签 + app_id 核对 +
金额核对 + 幂等）→ 订单入账 → `project_quotas` 派发 plan + `expiresAt`
（续费顺延）→ 应答裸文本 `success`。

- **过期收口**：`project_quotas.expiresAt`（迁移 0004）到期后 `resolveLimit` 按 free 处理。
- **配置**：`ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY / ALIPAY_PUBLIC_KEY / ALIPAY_NOTIFY_URL
  [/ ALIPAY_GATEWAY / ALIPAY_RETURN_URL]`；未配置时 checkout 503。
- **验收边界**：RSA2 协议层（签名/验签/篡改拒绝/金额核对/幂等）已用自造密钥对全量单测；
  真实网关联调需商户 app_id 与密钥（沙箱可用 ALIPAY_GATEWAY 指向沙箱网关）。
- 价目表：`PLAN_PRICING`（pro ¥99/月）。审计动作：`billing.checkout.create`、`billing.plan.change`。
- `ManualPaymentProvider`（共享密钥 webhook）保留作为无服务商时的人工派发通道。
