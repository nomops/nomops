import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { LICENSE_FEATURES } from '../ee/license/license-service.js';

/**
 * 企业代码边界（C1/C2）。
 *
 * `packages/server/src/ee/` 不是一个组织代码的目录，它是**授权边界**：
 * LICENSE_EE 按这条路径划定商业授权范围，文件移进移出就换了适用的许可证。
 * 边界一旦悄悄破掉，那部分代码就落回 Sustainable Use License——而 SUL 明文
 * 允许自托管者为自身业务目的修改软件，也就等于允许改掉验签解锁付费功能。
 *
 * 所以这组用例守两件事：法务文本和真实目录对得上；社区代码不反向依赖 ee。
 */
const SERVER_SRC = resolve(process.cwd(), 'src');
const REPO = resolve(process.cwd(), '../..');
const EE_DIR = join(SERVER_SRC, 'ee');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ★已知的社区 → ee 依赖，待偿清单。
 *
 * 这三处是 C1 迁移时暴露的**结构性纠缠**，不是疏忽：三个服务的「计数/记录」
 * 部分属于社区行为，只有「限额/查询」才是付费功能，所以社区核心确实要调它们。
 * 正确的解法是依赖倒置——社区侧定义端口（接口 + 空实现），ee 侧提供适配器，
 * 与本仓库已有的 IEncryptionKeyProvider / ISecretsProvider 同一手法。
 *
 * 在那之前，把它们显式钉在这里：数量只能减不能增。加新的一条就会红。
 */
const KNOWN_COMMUNITY_TO_EE = new Set([
  'services/execution-service.ts', // QuotaService：计数是社区行为，限额才是付费
  'services/credential-service.ts', // SecretsService：{{ $secrets.X }} 解析
  'triggers/active-workflow-manager.ts', // AuditService：写入始终进行，查询才门控
  'billing/billing-service.ts', // AuditService：同上
  // 组装层天然要认识两侧，不算违规，但仍登记以免无声扩散
  'bootstrap.ts',
  'app-services.ts',
  'app.ts',
  'controllers/index.ts',
]);

describe('LICENSE_EE 与真实目录', () => {
  it('ee 目录存在且非空（空目录 = 商业授权覆盖不到任何代码）', () => {
    expect(existsSync(EE_DIR)).toBe(true);
    expect(sourceFiles(EE_DIR).length).toBeGreaterThan(0);
  });

  it('LICENSE_EE 按 ee 目录划范围', () => {
    const text = readFileSync(join(REPO, 'LICENSE_EE'), 'utf8');

    expect(text).toContain('packages/server/src/ee/**');
  });

  it('主 LICENSE 指向 LICENSE_EE（两份文本必须互相引用才成体系）', () => {
    expect(readFileSync(join(REPO, 'LICENSE'), 'utf8')).toContain('LICENSE_EE');
  });

  it('★验签代码在 ee 内（不然「禁止改验签」这条无处落脚）', () => {
    expect(existsSync(join(EE_DIR, 'license', 'license-service.ts'))).toBe(true);
    expect(existsSync(join(EE_DIR, 'license', 'license-cert.ts'))).toBe(true);
  });

  it('★每个 license 功能位的实现都在 ee 内', () => {
    // 功能位 → 实现它的文件/目录（相对 ee/）。加功能位时这里会红,提醒把实现放进边界内。
    const homes: Record<(typeof LICENSE_FEATURES)[number], string> = {
      rbac: 'license/license-service.ts', // 权限矩阵由 license 门控驱动
      auditLogs: 'services/audit-service.ts',
      sso: 'sso/oidc-service.ts',
      saml: 'sso/saml-service.ts',
      scim: 'scim/scim-service.ts',
      quotas: 'services/quota-service.ts',
      logStreaming: 'services/log-streaming-service.ts',
      externalSecrets: 'services/secrets-service.ts',
      ldap: 'ldap/ldap-service.ts',
      sourceControl: 'services/git-service.ts',
    };
    const missing = LICENSE_FEATURES.filter((f) => !existsSync(join(EE_DIR, homes[f])));

    expect(missing).toEqual([]);
  });
});

describe('★依赖方向', () => {
  /** 社区侧（src 下除 ee 与测试外的全部文件）中，import 了 ee 的那些。 */
  function communityFilesImportingEe(): string[] {
    const hits: string[] = [];
    for (const file of sourceFiles(SERVER_SRC)) {
      if (file.startsWith(EE_DIR)) continue;
      const text = readFileSync(file, 'utf8');
      if (/from\s+'[^']*\/ee\//.test(text)) {
        hits.push(relative(SERVER_SRC, file).split('\\').join('/'));
      }
    }
    return hits;
  }

  it('没有新增的社区 → ee 依赖（待偿清单只减不增）', () => {
    const unexpected = communityFilesImportingEe().filter((f) => !KNOWN_COMMUNITY_TO_EE.has(f));

    expect(unexpected).toEqual([]);
  });

  it('待偿清单里的条目仍然真实（还清了就该从清单删掉）', () => {
    const actual = new Set(communityFilesImportingEe());
    const stale = [...KNOWN_COMMUNITY_TO_EE].filter((f) => !actual.has(f));

    expect(stale).toEqual([]);
  });

  it('ee 内部不反过来依赖 controllers（路由注册应由社区侧发起）', () => {
    const offenders = sourceFiles(EE_DIR).filter((file) =>
      /from\s+'[^']*controllers\//.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
