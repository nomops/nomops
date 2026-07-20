import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * LICENSE_EE 路径清单的一致性守卫。
 *
 * 法务文本按**文件路径**划定商业授权范围，而路径会随重构漂移。清单一旦指向
 * 不存在的文件，那部分代码就落回 Sustainable Use License——它明文允许自托管者
 * 为自身业务目的修改软件，也就等于允许改掉验签解锁付费功能。缺口是静默的。
 *
 * 这组用例不判断法律效力（那要律师），只保证文本描述的世界和真实代码对得上。
 */
const REPO = resolve(process.cwd(), '../..');
const EE_FILE = join(REPO, 'LICENSE_EE');

/** 从 LICENSE_EE 第 2 节抽出路径清单。 */
function declaredPaths(): string[] {
  const text = readFileSync(EE_FILE, 'utf8');
  const section = text.split('## 2. Enterprise Code')[1]?.split('## 3.')[0] ?? '';
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('packages/'));
}

describe('LICENSE_EE 路径清单', () => {
  it('文件存在', () => {
    expect(existsSync(EE_FILE)).toBe(true);
  });

  it('清单非空（空清单 = 商业授权覆盖不到任何代码）', () => {
    expect(declaredPaths().length).toBeGreaterThan(0);
  });

  it('★清单里的每条路径都真实存在（否则那部分代码静默落回 SUL）', () => {
    const missing = declaredPaths().filter((p) => !existsSync(join(REPO, p.replace('/**', ''))));

    expect(missing).toEqual([]);
  });

  it('★验签代码本身在清单覆盖范围内（不然「禁止改验签」这条无处落脚）', () => {
    const covered = declaredPaths().some((p) => p.startsWith('packages/server/src/license'));

    expect(covered).toBe(true);
  });

  it('主 LICENSE 指向 LICENSE_EE（两份文本必须互相引用才成体系）', () => {
    expect(readFileSync(join(REPO, 'LICENSE'), 'utf8')).toContain('LICENSE_EE');
  });

  it('每个 requireFeature 门控的服务都在清单内', () => {
    // 功能位 → 实现该功能的路径。加新功能位时这里会红,提醒同步法务文本。
    const featureHomes: Record<string, string> = {
      sso: 'packages/server/src/sso',
      saml: 'packages/server/src/sso',
      scim: 'packages/server/src/scim',
      ldap: 'packages/server/src/ldap',
      auditLogs: 'packages/server/src/services/audit-service.ts',
      quotas: 'packages/server/src/services/quota-service.ts',
      externalSecrets: 'packages/server/src/services/secrets-service.ts',
      logStreaming: 'packages/server/src/services/log-streaming-service.ts',
      sourceControl: 'packages/server/src/services/git-service.ts',
    };
    const declared = declaredPaths().map((p) => p.replace('/**', ''));
    const uncovered = Object.entries(featureHomes)
      .filter(([, home]) => !declared.includes(home))
      .map(([feature]) => feature);

    expect(uncovered).toEqual([]);
  });
});
