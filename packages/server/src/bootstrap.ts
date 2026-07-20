import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Cipher, Credentials, FileSystemBinaryStore, NodeLoader } from '@nomops/core';
import type { IEncryptionKeyProvider } from '@nomops/core';
import { createDatabase, createRepositories, runMigrations } from '@nomops/db';
import type { DatabaseConfig, DatabaseHandle, Repositories, SettingsRepository } from '@nomops/db';
import { builtinNodeManifest } from '@nomops/nodes';
import { AuthService } from './auth/auth-service.js';
import { CredentialService } from './services/credential-service.js';
import { ExecutionService } from './services/execution-service.js';
import { WorkflowService } from './services/workflow-service.js';
import { ApiKeyService } from './services/api-key-service.js';
import { MfaService } from './services/mfa-service.js';
import { CommunityNodeService, NpmNodeInstaller } from './services/community-node-service.js';
import type { INodeInstaller } from './services/community-node-service.js';
import { GitService } from './services/git-service.js';
import { PushHub } from './ws/push-hub.js';
import { ActiveWorkflowManager } from './triggers/active-workflow-manager.js';
import { LicenseService } from './license/license-service.js';
import { AuditService } from './services/audit-service.js';
import { OidcService } from './sso/oidc-service.js';
import { SamlService } from './sso/saml-service.js';
import { OAuth2Service } from './services/oauth2-service.js';
import { VariableService } from './services/variable-service.js';
import { DataTableService } from './services/data-table-service.js';
import { WaitTracker } from './services/wait-tracker.js';
import { ExecutionPruner, prunerOptionsFromEnv } from './services/execution-pruner.js';
import { ConcurrencyGate, concurrencyLimitFromEnv } from './services/concurrency-gate.js';
import type { IExecutionPrunerOptions } from './services/execution-pruner.js';
import { ScimService } from './scim/scim-service.js';
import { QuotaService } from './services/quota-service.js';
import { ManualPaymentProvider } from './billing/payment-provider.js';
import { BillingService } from './billing/billing-service.js';
import { AssistantService } from './services/assistant-service.js';
import { McpService } from './services/mcp-service.js';
import { LogStreamingService } from './services/log-streaming-service.js';
import { EnvSecretsProvider, SecretsService } from './services/secrets-service.js';
import type { ISecretsProvider } from './services/secrets-service.js';
import { LdapService } from './ldap/ldap-service.js';
import type { ILdapAuthenticator } from './ldap/ldap-service.js';
import { alipayFromEnv, type AlipayProvider } from './billing/alipay-provider.js';
import { InMemoryLockStore, LeaderElection } from './queue/leader.js';
import type { ILockStore } from './queue/leader.js';
import { createBullQueue, createRedisLockStore } from './queue/execution-queue.js';
import type { IExecutionQueue, RedisOptions } from './queue/execution-queue.js';
import type { AppServices } from './app-services.js';

/**
 * ★安装版的 IEncryptionKeyProvider（docs/01「第二个必须早做的抽象」）：
 * 从 settings 表读实例密钥，首次启动自动生成。Cloud 换 KMS 实现，业务零改动。
 */
class SettingsKeyProvider implements IEncryptionKeyProvider {
  private cached?: Buffer;

  constructor(private readonly settings: SettingsRepository) {}

  async getKey(): Promise<Buffer> {
    if (this.cached) return this.cached;
    const hex = await this.settings.get('encryptionKey');
    if (!hex) throw new Error('实例加密密钥未初始化（bootstrap 未运行？）');
    this.cached = Buffer.from(hex, 'hex');
    return this.cached;
  }
}

/** 确保实例级密钥存在（加密密钥 + JWT secret），幂等。 */
async function ensureInstanceSecrets(repos: Repositories): Promise<{ jwtSecret: string }> {
  let encryptionKey = await repos.settings.get('encryptionKey');
  if (!encryptionKey) {
    encryptionKey = randomBytes(32).toString('hex');
    await repos.settings.set('encryptionKey', encryptionKey, true);
  }
  let jwtSecret = await repos.settings.get('jwtSecret');
  if (!jwtSecret) {
    jwtSecret = randomBytes(32).toString('hex');
    await repos.settings.set('jwtSecret', jwtSecret, true);
  }
  return { jwtSecret };
}

export type ExecutionsMode = 'regular' | 'queue';
export type ProcessRole = 'main' | 'worker';

export interface BootstrapOptions {
  dbConfig?: DatabaseConfig;
  /** regular（单进程，默认）| queue（BullMQ + Redis）。 */
  mode?: ExecutionsMode;
  /** main（HTTP + 触发器调度）| worker（只消费队列）。 */
  role?: ProcessRole;
  /** License key（缺省读 LICENSE_KEY 环境变量）。测试显式注入。 */
  licenseKey?: string | null;
  /** License 验签公钥（base64 DER/SPKI）。缺省用内置公钥；测试注入自己那副。 */
  licensePublicKey?: string;
  /** billing webhook 共享密钥（缺省读 BILLING_SECRET；测试显式注入）。 */
  billingSecret?: string;
  /** 支付宝 provider（缺省从 ALIPAY_* 环境变量构造；测试注入假密钥实例）。 */
  alipay?: AlipayProvider | null;
  /** AI 助手的 Claude 调用（缺省真实 HTTP；测试注入假实现）。 */
  callClaude?: import('./services/assistant-service.js').CallClaude;
  /** 日志流的 webhook 推送函数（缺省真实 fetch；测试注入进程内接收器）。 */
  logStreamPost?: import('./services/log-streaming-service.js').PostFn;
  /** 外部密钥 provider（缺省 env 变量 provider；测试注入假 provider）。 */
  secretsProvider?: ISecretsProvider;
  /** LDAP 认证器（缺省 ldapts 真实实现；测试注入假实现）。 */
  ldapAuthenticator?: ILdapAuthenticator;
  /** 社区节点安装器（缺省 npm 真实实现；测试注入假实现映射到本地 fixture）。 */
  nodeInstaller?: INodeInstaller;
  /** 凭证连接测试的 HTTP 客户端（缺省真实 fetch；测试注入假实现，不打真网）。 */
  credentialTester?: import('./services/credential-test.js').ICredentialTester;
  /** 源码同步的 git 工作目录（缺省 NOMOPS_SOURCE_CONTROL_DIR 或 .nomops/source-control；测试传临时目录隔离）。 */
  sourceControlDir?: string;
  /** 等待唤醒器扫描间隔毫秒（缺省 10s；测试注入短间隔）。 */
  waitTrackerIntervalMs?: number;
  /** 执行历史清理配置（测试注入；生产走 NOMOPS_EXECUTIONS_* 环境变量）。 */
  pruner?: IExecutionPrunerOptions;
  /** 生产执行并发上限；-1 = 不限。缺省走 NOMOPS_CONCURRENCY_PRODUCTION_LIMIT。 */
  concurrencyLimit?: number;
}

export interface BootstrapResult {
  services: AppServices;
  dbHandle: DatabaseHandle;
  mode: ExecutionsMode;
  leader: LeaderElection;
  redis: RedisOptions | null;
  shutdown(): Promise<void>;
}

function redisFromEnv(): RedisOptions {
  return {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
  };
}

/** 组装全部依赖：DB → 迁移 → 密钥 → services → 触发器/队列。测试与 main/worker 共用。 */
export async function bootstrap(options: BootstrapOptions | DatabaseConfig = {}): Promise<BootstrapResult> {
  // 兼容旧签名 bootstrap(dbConfig)
  const opts: BootstrapOptions =
    'type' in options ? { dbConfig: options as DatabaseConfig } : (options as BootstrapOptions);

  const dbConfig: DatabaseConfig =
    opts.dbConfig ??
    (process.env['DB_TYPE'] === 'postgres'
      ? {
          type: 'postgres',
          url: process.env['DB_POSTGRES_URL'],
          dataDir: process.env['DB_DATA_DIR'],
        }
      : { type: 'sqlite', filename: process.env['DB_SQLITE_FILE'] ?? 'nomops.db' });

  const mode: ExecutionsMode =
    opts.mode ?? (process.env['EXECUTIONS_MODE'] === 'queue' ? 'queue' : 'regular');
  const role: ProcessRole = opts.role ?? 'main';

  const dbHandle = await createDatabase(dbConfig);
  await runMigrations(dbHandle);
  const repos = createRepositories(dbHandle);
  const { jwtSecret } = await ensureInstanceSecrets(repos);

  const nodeLoader = new NodeLoader(builtinNodeManifest);
  await nodeLoader.loadAll();

  const credentials = new Credentials(new Cipher(new SettingsKeyProvider(repos.settings)));
  const pushHub = new PushHub();

  // 队列与 leader：regular 用内存锁（单进程恒为 leader）；queue 用 Redis
  let queue: IExecutionQueue | null = null;
  let redis: RedisOptions | null = null;
  let lockStore: ILockStore;
  let redisLockClose: (() => Promise<unknown>) | null = null;
  if (mode === 'queue') {
    redis = redisFromEnv();
    if (role === 'main') queue = await createBullQueue(redis);
    const redisLock = await createRedisLockStore(redis);
    lockStore = redisLock;
    redisLockClose = redisLock.close;
  } else {
    lockStore = new InMemoryLockStore();
  }

  // 激活码优先级：显式注入(测试) > DB 里 UI 激活的 > 环境变量 LICENSE_KEY
  const storedLicenseKey = (await repos.settings.get('license.activationKey')) || null;
  const license = new LicenseService(
    opts.licenseKey ?? storedLicenseKey ?? process.env['LICENSE_KEY'] ?? null,
    opts.licensePublicKey,
  );
  const mfa = new MfaService(repos);
  const auth = new AuthService(repos, jwtSecret, mfa);
  const apiKeys = new ApiKeyService(repos);
  const workflows = new WorkflowService(repos, nodeLoader);
  // 社区节点：安装器缺省走 npm，装到 NOMOPS_COMMUNITY_NODES_DIR（默认 .nomops/nodes）
  const communityNodes = new CommunityNodeService(
    repos,
    nodeLoader,
    opts.nodeInstaller ??
      new NpmNodeInstaller(process.env['NOMOPS_COMMUNITY_NODES_DIR'] ?? join(process.cwd(), '.nomops', 'nodes')),
  );
  // 源码同步：把项目工作流 push/pull 到 git 仓库
  const git = new GitService(
    repos,
    workflows,
    opts.sourceControlDir ??
      process.env['NOMOPS_SOURCE_CONTROL_DIR'] ??
      join(process.cwd(), '.nomops', 'source-control'),
  );
  // 外部密钥（docs/10 B4）：凭证解密后物化 {{ $secrets.KEY }} 引用
  const secrets = new SecretsService(opts.secretsProvider ?? new EnvSecretsProvider(), license);
  const credentialService = new CredentialService(repos, credentials, secrets, opts.credentialTester);
  const quota = new QuotaService(repos, license);
  // 日志流（docs/10 B3）：先于 executions/audit 建好，两者把事件旁路到它
  const logStreaming = new LogStreamingService(repos, opts.logStreamPost);
  // 二进制存储：执行状态里只留引用，字节流落文件系统（Cloud 可换 S3 实现）
  const binaryStore = new FileSystemBinaryStore(
    process.env['NOMOPS_BINARY_DATA_DIR'] ?? join('.nomops', 'binary-data'),
  );
  const executions = new ExecutionService(
    repos,
    workflows,
    credentialService,
    nodeLoader,
    pushHub,
    quota,
    queue,
    (evt) => logStreaming.dispatch({ type: 'execution', at: new Date().toISOString(), ...evt }),
    binaryStore,
    new ConcurrencyGate(opts.concurrencyLimit ?? concurrencyLimitFromEnv(process.env)),
  );

  const leader = new LeaderElection(lockStore);
  const audit = new AuditService(repos, (entry) =>
    logStreaming.dispatch({
      type: 'audit',
      at: new Date().toISOString(),
      projectId: entry.projectId ?? null,
      action: entry.action,
      userId: entry.userId ?? null,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
    }),
  );
  const activeWorkflows = new ActiveWorkflowManager(
    repos,
    nodeLoader,
    executions,
    () => leader.isLeader(),
    audit,
  );
  // 等待唤醒器：leader 到点唤醒 waiting 执行（wait/resume）
  const waitTracker = new WaitTracker(repos, executions, opts.waitTrackerIntervalMs ?? 10_000);
  if (role === 'main') waitTracker.start();
  // 执行历史清理：leader 周期删除过期终态执行，防 executions/execution_data 无限增长
  const executionPruner = new ExecutionPruner(repos, () => leader.isLeader(), {
    ...prunerOptionsFromEnv(process.env),
    ...opts.pruner,
  });
  if (role === 'main') executionPruner.start();
  const baseUrl = process.env['NOMOPS_BASE_URL'] ?? 'http://localhost:5678';
  const sso = new OidcService(repos, credentials, auth, baseUrl);
  const saml = new SamlService(repos, credentials, auth, baseUrl);
  const oauth2 = new OAuth2Service(credentialService, baseUrl);
  const variables = new VariableService(repos);
  const dataTables = new DataTableService(repos);
  // LDAP 登录（docs/10 B5）：opts.ldapAuthenticator 供测试注入假实现；生产用 ldapts
  const ldap = new LdapService(repos, credentials, auth, license, opts.ldapAuthenticator);
  const scim = new ScimService(repos);
  // 支付适配层：当前 manual provider（共享密钥）；真实服务商实现 IPaymentProvider 后在此替换
  const payments = new ManualPaymentProvider(
    opts.billingSecret ?? process.env['BILLING_SECRET'] ?? randomBytes(24).toString('hex'),
  );
  const alipay = opts.alipay !== undefined ? opts.alipay : alipayFromEnv();
  const billing = new BillingService(repos, audit, alipay);
  // AI 助手：opts.callClaude 供测试注入假实现；生产用默认真实 HTTP
  const assistant = new AssistantService(repos, credentialService, nodeLoader, opts.callClaude);
  // 实例级 MCP：把勾选的工作流暴露为 MCP tools（Preview）
  const mcp = new McpService(repos, executions, workflows);

  const services: AppServices = {
    repos,
    nodeLoader,
    auth,
    apiKeys,
    mfa,
    workflows,
    communityNodes,
    git,
    credentials: credentialService,
    executions,
    pushHub,
    activeWorkflows,
    license,
    audit,
    sso,
    saml,
    scim,
    quota,
    payments,
    billing,
    alipay,
    assistant,
    logStreaming,
    secrets,
    ldap,
    oauth2,
    variables,
    dataTables,
    waitTracker,
    executionPruner,
    mcp,
  };

  // 重载已安装社区节点（main/worker 都需要，执行时才能解析到）。尽力而为，失败不崩启动。
  await communityNodes.loadInstalled();

  // Cloud：控制平面注入 NOMOPS_OWNER_EMAIL → 首启预置 owner（docs/11 Phase 2）
  const ownerEmail = process.env['NOMOPS_OWNER_EMAIL'];
  if (ownerEmail) {
    await auth.ensureOwner(ownerEmail);
    // 订阅 plan 下发（docs/11 Phase 3）：把控制平面下发的配额落到 owner 项目（每次启动幂等应用，升级即生效）
    const planQuota = process.env['NOMOPS_PLAN_QUOTA'];
    if (planQuota) {
      const owner = await repos.users.findByEmail(ownerEmail);
      if (owner) {
        const limit = planQuota === 'unlimited' ? null : Number(planQuota);
        const planName = process.env['NOMOPS_PLAN'] ?? 'free';
        for (const project of await repos.projects.findAllByUser(owner.id)) {
          await repos.quotas.upsertQuota(project.id, planName, Number.isFinite(limit as number) ? limit : null);
        }
      }
    }
  }

  return {
    services,
    dbHandle,
    mode,
    leader,
    redis,
    shutdown: async () => {
      waitTracker.stop();
      executionPruner.stop();
      await activeWorkflows.shutdown();
      await leader.stop();
      await queue?.close();
      await redisLockClose?.();
      await dbHandle.close();
    },
  };
}
