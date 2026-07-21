# 页面审计 · Credentials（列表 + 类型选择 + 编辑弹窗）P0

- 基线路由：`/home/credentials/:credentialId?`（`features/credentials/views/CredentialsView.vue`）
- 弹窗：`CREDENTIAL_SELECT_MODAL_KEY`（选类型）、`CREDENTIAL_EDIT_MODAL_KEY`（`CredentialEdit.vue`）
- Nomops：`?tab=credentials` 列表 + `components/credentials/CredentialModal.vue`（656 行）
- 截图：`screenshots/n8n/home-credentials.png` · `credential-select-modal.png` · `credential-edit-modal.png`；`screenshots/nomops/overview-credentials.png` · `credential-edit-modal.png`

## A. 列表
| 元素 | n8n | Nomops | 差异 |
|---|---|---|---|
| 主按钮 | `Create credential` + 下拉 | 一致 | 一致 |
| 搜索 | `Search credentials...` | 一致 | 一致 |
| 排序/筛选 | Sort by last updated + 漏斗 | 一致 | 一致 |
| 行 | 图标 + 名 + 类型 + `Last updated / Created` + 归属徽章 + `⋯` | 一致 | 一致 |
| 关联计数徽章 | `🔗 2`（被 N 处引用） | 有（`🔗 2`） | 一致 |

## B. 类型选择弹窗（Add new credential）
| 元素 | n8n | Nomops | 差异 |
|---|---|---|---|
| 标题 | `Add new credential` | 待核对文案 | ⏳ |
| 副标题 | `Select an app or service to connect to` | 待核对 | ⏳ |
| 类型搜索 | `Search for app...` + 全量凭证类型列表 | 待核对（依赖 Nomops 已实现的凭证类型数量） | ⏳ |
| 关闭 | × | — | — |

> n8n 列表含数百内建凭证类型；Nomops 凭证类型数量取决于已移植节点集。**类型覆盖度是独立的节点移植问题，非 UI gap**，此处只对齐弹窗交互结构。

## C. 编辑弹窗（CredentialEdit）—— 核心
n8n 结构（`credential-edit-modal.png`）：
- **头**：凭证图标 + 名称 + 类型副标 + `Save` / 删除(🗑) / 关闭(×)。
- **左 Tab**：`Connection` / `Sharing` / `Details`。
- **Connection 体**：
  - 「Need help filling out these fields? Read our docs」提示条。
  - **连接测试结果条**（自动测试）：失败「Couldn't connect with these settings — More details」+ `Retry`（红）；成功为绿条。
  - 字段区：如 `API Key *`（密码框）、`Allowed HTTP Request Domains`（**Fixed/Expression 切换** + 下拉）、`Allowed Domains`。
  - 底部「Enterprise plan users can pull in credentials from external vaults. More info」。

Nomops 结构（`nomops/credential-edit-modal.png`）：
- **头**：图标 + 名 `DeepSeek API account` + 类型 `DeepSeek` + `Save` / 删除 / 关闭 ✓
- **左 Tab**：`Connection` / `Sharing` / `Details` ✓
- 「Need help… Read our docs」✓；「Enterprise plan users can pull in credentials from external vaults. More info」✓
- 字段：`API Key *`（密码框，占位 `(leave blank to keep current value)`）✓
- 连接测试：**手动 `Test connection` 按钮**（无自动测试结果条）

| 元素 | n8n | Nomops 现状 | 差异类型 |
|---|---|---|---|
| 头部/三 Tab/文案/enterprise 提示 | 有 | 全有 | 一致 |
| 密码字段 + 保留占位 | 有 | 有 | 一致 |
| **连接测试** | 打开时**自动测试** + 结果条（红/绿）+ More details/Retry | **手动按钮** `Test connection`，无结果条 | **不一致**（缺自动测试 + 结果状态条） |
| **字段 Fixed/Expression 切换** | 有（每个可表达式字段） | **未见**（当前字段无切换） | **缺失**（凭证字段表达式支持） |
| Sharing Tab（企业共享） | 有 | 存在（Tab 在） | 内容待核对 ⏳ |
| Details Tab（id/创建人/时间） | 有 | 存在 | 内容待核对 ⏳ |
| OAuth「Connect my account」流 | OAuth 类型有授权按钮 | 待核对 | ⏳ |

## D. 差异小结（进 gap-list）
1. **连接测试自动化 + 结果状态条**：n8n 打开即测并展示红/绿结果 + Retry；Nomops 仅手动 `Test connection` 按钮无结果条 —— 不一致（P1，源：`CredentialEdit` + `/rest/credentials/test`；Nomops `CredentialModal.vue:223 testConnection`/`:396` 手动按钮）。
2. **凭证字段 Fixed/Expression 切换**（已核实收窄）：Nomops **节点参数已有** Fixed/Expression 分段控件（`ParamInput.vue:245`，覆盖 string/number/options/…）；但**凭证 modal 用自渲染字段**（`CredentialModal.vue:531 .field input`，未接 `ParamInput`），故凭证字段无表达式切换。n8n 凭证字段经 `ParameterInputFull` 支持切换（截图见 DeepSeek「Allowed HTTP Request Domains」的 Fixed/Expression）。→ **仅凭证字段缺表达式切换**（P2，源：让 `CredentialModal` 字段复用 `ParamInput`）。
3. Sharing / Details Tab 内容、OAuth「Connect my account」授权流（`CredentialModal.vue:13/351` 已有 OAuth 分支）—— 待下一轮逐项核对。
