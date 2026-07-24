import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  Cipher,
  Credentials,
  FileSystemBinaryStore,
  NodeLoader,
  S3BinaryStore,
  collectBinaryIds,
  s3StoreOptionsFromEnv,
} from '@nomops/core';
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
import { GitService } from './ee/services/git-service.js';
import { SharingService } from './ee/services/sharing-service.js';
import { NullMailer, SmtpMailer, mailerConfigFromEnv, type IMailer } from './services/mailer.js';
import { PushHub } from './ws/push-hub.js';
import { ActiveWorkflowManager } from './triggers/active-workflow-manager.js';
import { LicenseService } from './ee/license/license-service.js';
import { AuditService } from './services/audit-service.js';
import { OidcService } from './ee/sso/oidc-service.js';
import { SamlService } from './ee/sso/saml-service.js';
import { OAuth2Service } from './services/oauth2-service.js';
import { VariableService } from './services/variable-service.js';
import { DataTableService } from './services/data-table-service.js';
import { EvaluationService } from './services/evaluation-service.js';
import { SttService } from './services/stt-service.js';
import { WaitTracker } from './services/wait-tracker.js';
import { ExecutionPruner, prunerOptionsFromEnv } from './services/execution-pruner.js';
import { SchedulerService } from './services/scheduler-service.js';
import type { SchedulerOptions } from './services/scheduler-service.js';
import { InsightsService } from './services/insights-service.js';
import { AgentRunService } from './services/agent-run-service.js';
import { AgentChannelService } from './services/agent-channel-service.js';
import { WorkflowBuilderService } from './services/workflow-builder-service.js';
import { InstanceAiService } from './services/instance-ai-service.js';
import {
  ConcurrencyGate,
  concurrencyLimitFromEnv,
  queueDepthFromEnv,
} from './services/concurrency-gate.js';
import { CountingUsageGate } from './services/usage-gate.js';
import type { IExecutionPrunerOptions } from './services/execution-pruner.js';
import { ScimService } from './ee/scim/scim-service.js';
import { QuotaService } from './ee/services/quota-service.js';
import { ManualPaymentProvider } from './billing/payment-provider.js';
import { BillingService } from './billing/billing-service.js';
import { AssistantService } from './services/assistant-service.js';
import { McpService } from './services/mcp-service.js';
import { LogStreamingService } from './ee/services/log-streaming-service.js';
import { OtelService } from './ee/services/otel-service.js';
import { SecretsService, secretsProviderFromEnv } from './ee/services/secrets-service.js';
import type { ISecretsProvider } from './ee/services/secrets-service.js';
import { LdapService } from './ee/ldap/ldap-service.js';
import type { ILdapAuthenticator } from './ee/ldap/ldap-service.js';
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
  logStreamPost?: import('./ee/services/log-streaming-service.js').PostFn;
  /** syslog 发送器（缺省真实 UDP/TCP；测试注入进程内接收器）。 */
  logStreamSyslog?: import('./ee/services/log-streaming-service.js').SyslogFn;
  /** 外部密钥 provider（缺省 env 变量 provider；测试注入假 provider）。 */
  secretsProvider?: ISecretsProvider;
  /** LDAP 认证器（缺省 ldapts 真实实现；测试注入假实现）。 */
  ldapAuthenticator?: ILdapAuthenticator;
  /** STT 转写 fetch（缺省全局 fetch；测试注入假实现）。 */
  sttFetch?: typeof fetch;
  /** Telegram Bot API fetch（#44 M5；测试注入假实现,不打真实网络）。 */
  telegramFetch?: typeof fetch;
  /** 邮件投递（测试注入记录桩;生产按 NOMOPS_SMTP_* 环境变量,未配置为 NullMailer）。 */
  mailer?: IMailer;
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
  /** DB 调度器配置（#38；测试注入短轮询/固定时钟/instanceId）。 */
  scheduler?: SchedulerOptions;
  /** 引擎 httpRequest 覆盖（#44 M2；测试注入假 AI provider，避免打真实网络）。 */
  httpRequest?: (options: unknown) => Promise<unknown>;
  /** 生产执行并发上限；-1 = 不限。缺省走 NOMOPS_CONCURRENCY_PRODUCTION_LIMIT。 */
  concurrencyLimit?: number;
  /** 等待队列深度上限；缺省 2× 并发上限。超出即 503。 */
  concurrencyQueueDepth?: number;
  /** S3 二进制存储配置（测试注入假客户端；生产走 NOMOPS_S3_* 环境变量）。 */
  s3?: import('@nomops/core').IS3StoreOptions | null;
}

export interface BootstrapResult {
  services: AppServices;
  dbHandle: DatabaseHandle;
  mode: ExecutionsMode;
  leader: LeaderElection;
  redis: RedisOptions | null;
  /** DB 调度器（#38；测试可手动 tick）。 */
  scheduler: SchedulerService;
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

  // #34 一次性回填：全局 workflows.favorite → 各项目 owner 的 user_favorites。
  // settings 标志位保证只跑一次（否则用户取消收藏后重启会被重新加回）。
  if (!(await repos.settings.get('favorites.backfilled'))) {
    const moved = await repos.favorites.backfillFromWorkflowFlag().catch(() => -1);
    if (moved >= 0) await repos.settings.set('favorites.backfilled', String(moved));
  }

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
    new Cipher(new SettingsKeyProvider(repos.settings)),
  );
  // 外部密钥（docs/10 B4）：凭证解密后物化 {{ $secrets.KEY }} 引用。
  // provider 可选 env 变量 / Vault（NOMOPS_SECRETS_PROVIDER）；测试注入 opts.secretsProvider。
  const secretsSelection = opts.secretsProvider
    ? { provider: opts.secretsProvider }
    : secretsProviderFromEnv(process.env);
  if (secretsSelection.start) await secretsSelection.start(); // Vault 预热快照
  const secrets = new SecretsService(secretsSelection.provider, license);
  const credentialService = new CredentialService(repos, credentials, secrets, opts.credentialTester);
  // 用量:社区无条件计数;企业版在其上加限额检查(ee 实现包住社区实现)
  const usageCounter = new CountingUsageGate(repos);
  const quota = new QuotaService(repos, license, usageCounter);
  // 日志流（docs/10 B3）：先于 executions/audit 建好，两者把事件旁路到它
  const logStreaming = new LogStreamingService(repos, opts.logStreamPost, opts.logStreamSyslog);
  // 二进制存储：执行状态里只留引用，字节流落 store。
  // 配了 NOMOPS_S3_BUCKET 走 S3 兼容后端（AWS/MinIO/R2），否则文件系统。
  const s3Options = opts.s3 ?? s3StoreOptionsFromEnv(process.env);
  const binaryStore = s3Options
    ? new S3BinaryStore(s3Options)
    : new FileSystemBinaryStore(
        process.env['NOMOPS_BINARY_DATA_DIR'] ?? join('.nomops', 'binary-data'),
      );
  const baseUrl = process.env['NOMOPS_BASE_URL'] ?? 'http://localhost:5678';
  const otel = new OtelService(repos); // OpenTelemetry 追踪导出（#27）
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
    new ConcurrencyGate(
      opts.concurrencyLimit ?? concurrencyLimitFromEnv(process.env),
      opts.concurrencyQueueDepth ?? queueDepthFromEnv(process.env),
    ),
    baseUrl,
    (trace) => otel.exportExecution(trace),
    opts.httpRequest, // #44 M2：测试注入假 provider
  );

  // binary GC（#22）：删执行记录（单删/批删/pruner/save-policy）前先清其 binary 引用
  if (binaryStore.delete) {
    repos.executions.setBeforeDelete(async (data) => {
      for (const id of collectBinaryIds(data)) await binaryStore.delete!(id).catch(() => undefined);
    });
  }

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
    // binary 孤儿清理与执行清理同周期（store 不支持 list/delete 时 sweep 内部返回 0）
    sweepOrphanBinaries: () => executions.sweepOrphanBinaries(),
  });
  if (role === 'main') executionPruner.start();

  const insights = new InsightsService(repos);
  const agentRuns = new AgentRunService(repos, executions);
  // #44 M5：外部渠道（Telegram webhook → agent 线程 → 回复回渠道）
  const agentChannels = new AgentChannelService(repos, agentRuns, credentialService, baseUrl, opts.telegramFetch);

  // DB 调度器（#38 地基项）：Schedule Trigger 落库触发,重启不丢、多实例只触发一次。
  // fire 按 job.kind 分派;配额 429 跳过本次不重试。所有实例都跑循环,靠租约去重。
  const scheduler = new SchedulerService(repos, async (job) => {
    if (job.kind === 'insights-rollup') {
      await insights.rollup(); // #39b：卷积旧 raw → by_period + 剪旧
      return null;
    }
    if (job.kind === 'agent-task') {
      // #44 M4：定时触发 agent。任务已删/停用→静默跳过;配额 429 同工作流口径跳过不重试
      try {
        return await agentRuns.runTask(String(job.config['taskId'] ?? ''));
      } catch (e) {
        if ((e as { status?: number }).status === 429) return null;
        throw e;
      }
    }
    if (!job.workflowId || !job.nodeName) return null;
    try {
      const summary = await executions.runTriggered(
        job.workflowId,
        'trigger',
        [{ json: { timestamp: new Date().toISOString() } }],
        job.nodeName,
      );
      return summary.executionId;
    } catch (e) {
      if ((e as { status?: number }).status === 429) return null; // 配额超限：跳过,不重试风暴
      throw e;
    }
  }, opts.scheduler);
  // #39b：注册全局 Insights 卷积作业(每小时),幂等——已存在则不重复建
  if (role === 'main' && !(await repos.scheduler.findJobByKind('insights-rollup'))) {
    await repos.scheduler.createJob({
      kind: 'insights-rollup',
      workflowId: null,
      nodeName: null,
      config: { mode: 'interval', everySeconds: 3600 },
      nextRunAt: new Date(Date.now() + 3600_000),
      maxAttempts: 1,
    });
  }
  if (role === 'main') scheduler.start();

  // #43：实例升级史——版本变化即记一条（NOMOPS_VERSION 可覆盖，缺省 0.1.0）
  if (role === 'main') {
    const version = process.env['NOMOPS_VERSION'] ?? '0.1.0';
    const latest = await repos.platform.latestVersion();
    if (!latest || latest.version !== version) await repos.platform.recordVersion(version);
  }

  // #44 M1：一次性把旧 chat_agents(个人 chat agent) 迁进新 agents 平台（迁至各自个人项目,
  // config={system}）——非破坏,chat_agents 原样保留;settings 标志位保证只跑一次。
  if (role === 'main' && !(await repos.settings.get('agents.backfilled'))) {
    let moved = 0;
    for (const user of await repos.users.findAll().catch(() => [])) {
      const projects = await repos.projects.findAllByUser(user.id).catch(() => []);
      const personal = projects.find((p) => p.type === 'personal') ?? projects[0];
      if (!personal) continue;
      for (const ca of await repos.chat.listAgents(user.id).catch(() => [])) {
        await repos.agents
          .create({ projectId: personal.id, name: ca.name, description: '', config: { system: ca.system } })
          .then(() => (moved += 1))
          .catch(() => undefined);
      }
    }
    await repos.settings.set('agents.backfilled', String(moved));
  }

  const sso = new OidcService(repos, credentials, auth, baseUrl);
  const saml = new SamlService(repos, credentials, auth, baseUrl);
  const oauth2 = new OAuth2Service(credentialService, baseUrl);
  // OAuth2 token 临期自动续期（#16）:执行注入前经 refresher 兜一手
  credentialService.setTokenRefresher((id, pid) => oauth2.refreshIfNeeded(id, pid));
  const variables = new VariableService(repos);
  const dataTables = new DataTableService(repos);
  const evaluations = new EvaluationService(repos, workflows, executions);
  const stt = new SttService(repos, opts.sttFetch);
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
  // #45 M1：AI 建流会话（多轮迭代临时草稿 → Apply 物化为正式 workflow）
  const workflowBuilder = new WorkflowBuilderService(repos, assistant, workflows);
  // #45 M2：有检查点的 AI 线程底座（实例助手,可回滚续跑）
  const instanceAi = new InstanceAiService(repos, assistant);
  // 实例级 MCP：把勾选的工作流暴露为 MCP tools（Preview）
  const mcp = new McpService(repos, executions, workflows);
  const sharing = new SharingService(repos, workflows, credentialService);
  const mailerConfig = mailerConfigFromEnv(process.env);
  const mailer: IMailer = opts.mailer ?? (mailerConfig ? new SmtpMailer(mailerConfig) : new NullMailer());

  const services: AppServices = {
    repos,
    nodeLoader,
    auth,
    apiKeys,
    mfa,
    workflows,
    communityNodes,
    git,
    sharing,
    mailer,
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
    otel,
    secrets,
    ldap,
    oauth2,
    variables,
    dataTables,
    evaluations,
    stt,
    insights,
    agentRuns,
    agentChannels,
    workflowBuilder,
    instanceAi,
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
    scheduler,
    shutdown: async () => {
      waitTracker.stop();
      executionPruner.stop();
      scheduler.stop();
      await activeWorkflows.shutdown();
      await leader.stop();
      await queue?.close();
      await redisLockClose?.();
      await dbHandle.close();
    },
  };
}
