import { z } from 'zod';

/** 所有外部输入先过 Zod（docs/05 编码规范）。 */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(), // 两步验证：TOTP 码或备份码
});

/** 个人资料（Settings → Personal）。 */
export const updateMeSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

/** 邀请用户（实例 admin）：邮箱 + 实例角色（owner 只能由降级/建初始 owner 产生，不可邀请）。 */
export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).optional(),
});

/** 接受邀请：设姓名 + 口令。 */
export const acceptInviteSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

/** INode 结构（docs/02 第二节）。 */
export const nodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  typeVersion: z.number().int().positive(),
  position: z.tuple([z.number(), z.number()]),
  parameters: z.record(z.unknown()),
  credentials: z.record(z.object({ id: z.string(), name: z.string() })).optional(),
  disabled: z.boolean().optional(),
  continueOnError: z.boolean().optional(),
});

/** IConnections 结构。 */
export const connectionsSchema = z.record(
  z.record(
    z.array(
      z
        .array(z.object({ node: z.string(), type: z.string(), index: z.number().int().min(0) }))
        .nullable(),
    ),
  ),
);

/** 钉住数据：nodeName → 冻结输出 items（json 必填，binary/pairedItem 透传）。null = 清空。 */
export const pinDataSchema = z
  .record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough()).max(200))
  .nullable();

export const workflowBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  nodes: z.array(nodeSchema),
  connections: connectionsSchema,
  settings: z.record(z.unknown()).optional(),
  pinData: pinDataSchema.optional(),
  folderId: z.string().nullable().optional(), // 所属文件夹；null = 项目根
});

/** 文件夹：项目内组织工作流，支持嵌套。 */
export const folderBodySchema = z.object({
  name: z.string().min(1).max(200),
  parentFolderId: z.string().nullable().optional(),
});
export const folderPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentFolderId: z.string().nullable().optional(),
});

export const workflowPatchSchema = workflowBodySchema.partial();

export const communityNodeInstallSchema = z.object({
  name: z.string().min(1).max(214), // npm 包名（可 scoped），上限同 npm
  version: z.string().min(1).max(100).optional(),
});

/** 连接源码仓库（实例 admin）。 */
export const sourceControlConnectSchema = z.object({
  repoUrl: z.string().min(1).max(500),
  branch: z.string().min(1).max(200).optional(),
});

/** push 提交信息。 */
export const sourceControlPushSchema = z.object({
  message: z.string().max(500).optional(),
});

/** 激活许可证（实例 admin）。 */
export const licenseActivateSchema = z.object({
  activationKey: z.string().min(1, 'Activation key is required').max(5000),
});

/** 画布/API 聊天（Chat Trigger）。 */
export const chatBodySchema = z.object({
  message: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(100).optional().default('default'),
});

export const runBodySchema = z.object({
  destinationNode: z.string().optional(),
  /** 多触发器画布：从指定 trigger 节点开始执行（对标基线 "Execute workflow from X"）。 */
  startNode: z.string().optional(),
  /** true = 部分执行：复用最近一次执行的干净上游数据，只重跑脏子图（需配合 destinationNode）。 */
  usePreviousData: z.boolean().optional(),
});

export const activateBodySchema = z.object({
  active: z.boolean(),
});

const projectRoleSchema = z.enum(['project:viewer', 'project:editor', 'project:owner']);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
});

export const tagBodySchema = z.object({
  name: z.string().min(1).max(50),
});

export const workflowTagsSchema = z.object({
  tagIds: z.array(z.string()).max(20),
});

export const variableBodySchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10_000).optional().default(''),
});

export const dataTableColumnSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'boolean', 'date']).optional().default('string'),
});

export const dataTableBodySchema = z.object({
  name: z.string().min(1).max(200),
  columns: z.array(dataTableColumnSchema).optional().default([]),
});

export const dataTableRenameSchema = z.object({
  name: z.string().min(1).max(200),
});

export const dataTableRowSchema = z.object({
  data: z.record(z.unknown()).optional().default({}),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: projectRoleSchema,
});

export const patchMemberSchema = z.object({
  role: projectRoleSchema,
});

export const quotaBodySchema = z
  .object({
    plan: z.enum(['free', 'pro', 'unlimited', 'custom']),
    monthlyExecutions: z.number().int().positive().optional(),
  })
  .refine((v) => v.plan !== 'custom' || v.monthlyExecutions !== undefined, {
    message: 'The custom plan requires monthlyExecutions',
  });

/**
 * SAML 2.0 配置（B2）。与 OIDC 并存,两者是独立的 IdP 接入方式。
 * spPrivateKey 省略 = 保留旧值(与 OIDC 的 clientSecret 同一约定)。
 */
export const samlConfigSchema = z.object({
  enabled: z.boolean(),
  idpEntityId: z.string().min(1),
  idpSsoUrl: z.string().url(),
  /** IdP 签名证书(裸 base64 或 PEM,可多份以支持轮换)。 */
  idpCertificates: z.array(z.string().min(1)).min(1),
  attributeMapping: z
    .object({
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
  spPrivateKey: z.string().optional(),
  spCertificate: z.string().optional(),
});

export const ssoConfigSchema = z.object({
  enabled: z.boolean(),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  /** 省略 = 保留已存 secret（更新其他字段时不必重填）。 */
  clientSecret: z.string().min(1).optional(),
});

export const credentialBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  data: z.record(z.unknown()), // 明文只在请求瞬间存在，立刻加密
});

/** 编辑凭证：改名 + 覆写填写的字段（留空字段 = 保持不变，type 不可改）。 */
export const credentialPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  data: z.record(z.unknown()).optional(),
});
