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

export const workflowBodySchema = z.object({
  name: z.string().min(1).max(200),
  nodes: z.array(nodeSchema),
  connections: connectionsSchema,
  settings: z.record(z.unknown()).optional(),
  folderId: z.string().nullable().optional(), // 所属文件夹；null = 项目根
});

/** 文件夹（对标 n8n）：项目内组织工作流，支持嵌套。 */
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

export const runBodySchema = z.object({
  destinationNode: z.string().optional(),
});

export const activateBodySchema = z.object({
  active: z.boolean(),
});

const projectRoleSchema = z.enum(['project:viewer', 'project:editor', 'project:owner']);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
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
