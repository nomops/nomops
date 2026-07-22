import { OperationalError } from '@nomops/workflow';
import type { Repositories } from '@nomops/db';
import type { WorkflowService } from '../../services/workflow-service.js';
import type { CredentialService } from '../../services/credential-service.js';

/**
 * 工作流/凭证共享（backlog #12,企业功能 `sharing`——实现按边界铁律落在 ee/）。
 *
 * 模型：shared_workflows / shared_credentials 本就是归属 join 表（owner 行）,
 * 共享 = 给目标项目插非 owner 行——所有 projectId-scoped 读路径自动生效（铁律 2 复用）。
 * 角色语义：workflow:editor = 读/跑/改;credential:user = 执行注入可用,不可读改秘密。
 * 删/改秘密/管理共享面恒为 owner 项目专属（社区服务层的 assertOwnerProject 把关,
 * 无论有无 license 都生效——共享行只可能在有 license 时产生）。
 */
export interface IShareRow {
  projectId: string;
  role: string;
  projectName: string;
  projectType: string;
}

export interface IShareTarget {
  projectId: string;
  kind: 'user' | 'project';
  label: string;
}

export class SharingService {
  constructor(
    private readonly repos: Repositories,
    private readonly workflows: WorkflowService,
    private readonly credentials: CredentialService,
  ) {}

  /* ── 工作流 ── */

  async listWorkflowShares(id: string, projectId: string): Promise<IShareRow[]> {
    await this.workflows.getById(id, projectId);
    await this.workflows.assertOwnerProject(id, projectId);
    return this.repos.workflows.listShares(id);
  }

  async setWorkflowShares(id: string, projectId: string, targetProjectIds: string[]): Promise<IShareRow[]> {
    await this.workflows.getById(id, projectId);
    await this.workflows.assertOwnerProject(id, projectId);
    await this.assertProjectsExist(targetProjectIds);
    await this.repos.workflows.setShares(id, targetProjectIds);
    return this.repos.workflows.listShares(id);
  }

  /* ── 凭证 ── */

  async listCredentialShares(id: string, projectId: string): Promise<IShareRow[]> {
    await this.assertCredentialVisible(id, projectId);
    await this.credentials.assertOwnerProject(id, projectId);
    return this.repos.credentials.listShares(id);
  }

  async setCredentialShares(id: string, projectId: string, targetProjectIds: string[]): Promise<IShareRow[]> {
    await this.assertCredentialVisible(id, projectId);
    await this.credentials.assertOwnerProject(id, projectId);
    await this.assertProjectsExist(targetProjectIds);
    await this.repos.credentials.setShares(id, targetProjectIds);
    return this.repos.credentials.listShares(id);
  }

  /* ── 目标清单：其他用户的个人项目 + 请求者所在的团队项目（排除当前项目） ── */

  async shareTargets(userId: string, currentProjectId: string): Promise<IShareTarget[]> {
    const targets: IShareTarget[] = [];
    for (const user of (await this.repos.users.findAll()).filter((u) => !u.disabled && u.id !== userId)) {
      const personal = (await this.repos.projects.findAllByUserWithRole(user.id)).find((p) => p.type === 'personal');
      if (personal && personal.id !== currentProjectId) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
        targets.push({
          projectId: personal.id,
          kind: 'user',
          label: name ? `${name} (${user.email})` : user.email,
        });
      }
    }
    for (const p of (await this.repos.projects.findAllByUserWithRole(userId)).filter(
      (p) => p.type === 'team' && p.id !== currentProjectId,
    )) {
      targets.push({ projectId: p.id, kind: 'project', label: p.name });
    }
    return targets;
  }

  /* ── 内部 ── */

  private async assertCredentialVisible(id: string, projectId: string): Promise<void> {
    if (!(await this.repos.credentials.findById(id, projectId))) {
      throw new OperationalError('Credential not found', { credentialId: id, status: 404 });
    }
  }

  private async assertProjectsExist(projectIds: string[]): Promise<void> {
    for (const target of [...new Set(projectIds)]) {
      if (!(await this.repos.projects.findById(target))) {
        throw new OperationalError(`Project not found: ${target}`, { status: 400 });
      }
    }
  }
}
