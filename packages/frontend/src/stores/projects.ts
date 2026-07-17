import { defineStore } from 'pinia';
import { api, projectStorage, type LicenseInfo, type ProjectRow } from '../api/client.js';

/**
 * 项目上下文（docs/06）：当前项目 id 持久化到 localStorage，
 * API client 对每个请求注入 X-Project-Id。切换后由调用方刷新页面数据。
 */
export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [] as ProjectRow[],
    currentProjectId: projectStorage.get(),
    license: null as LicenseInfo | null,
    loaded: false,
  }),
  getters: {
    current(): ProjectRow | null {
      if (this.projects.length === 0) return null;
      return this.projects.find((p) => p.id === this.currentProjectId) ?? this.projects[0] ?? null;
    },
    /** 我在当前项目的角色（控制 UI 可见性；后端仍是权威）。 */
    currentRole(): string {
      return this.current?.role ?? 'project:viewer';
    },
    /** 展示名：个人项目统一显示为 "Personal"，团队项目用真实名。 */
    currentName(): string {
      const c = this.current;
      return !c || c.type === 'personal' ? 'Personal' : c.name;
    },
    hasFeature(): (feature: string) => boolean {
      return (feature) => this.license?.features.includes(feature) ?? false;
    },
  },
  actions: {
    async fetch() {
      const [projects, license] = await Promise.all([api.projects.list(), api.license()]);
      this.projects = projects;
      this.license = license;
      this.loaded = true;
      // 持久化的项目已不可访问（被移除等）→ 回落到默认
      if (this.currentProjectId && !projects.some((p) => p.id === this.currentProjectId)) {
        this.switchTo(null);
      }
    },
    /** 切换项目上下文。null = 回 token 默认（personal）。 */
    switchTo(projectId: string | null) {
      this.currentProjectId = projectId;
      if (projectId) projectStorage.set(projectId);
      else projectStorage.clear();
    },
    async createProject(name: string) {
      const project = await api.projects.create(name);
      await this.fetch();
      return project;
    },
    reset() {
      this.projects = [];
      this.currentProjectId = null;
      this.license = null;
      this.loaded = false;
      projectStorage.clear();
    },
  },
});
