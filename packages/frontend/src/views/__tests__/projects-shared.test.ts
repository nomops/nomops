import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projects = readFileSync(resolve(process.cwd(), 'src/views/ProjectsView.vue'), 'utf8');
const shared = readFileSync(resolve(process.cwd(), 'src/views/SharedView.vue'), 'utf8');

describe('Projects 页面 UI 契约', () => {
  it('创建项目使用产品内弹窗，不在页头常驻输入框', () => {
    expect(projects).toContain("import UiDialog from '../components/ui/UiDialog.vue'");
    expect(projects).toContain('test-id="projects-create-dialog"');
    expect(projects).toContain('data-test="create-project-submit"');
  });

  it('移除成员需要确认并提供结果反馈', () => {
    expect(projects).toContain("title: 'Remove project member?'");
    expect(projects).toContain('await ui.requestConfirm({');
    expect(projects).toContain("title: 'Project member removed'");
  });

  it('加载、失败和空项目均有独立状态', () => {
    expect(projects).toContain('title="Loading projects"');
    expect(projects).toContain('title="Could not load projects"');
    expect(projects).toContain('title="No projects yet"');
  });
});

describe('Shared 页面 UI 契约', () => {
  it('加载失败不伪装为空列表，并提供重试', () => {
    expect(shared).toContain('title="Loading shared resources"');
    expect(shared).toContain('title="Could not load shared resources"');
    expect(shared).toContain('<button class="btn" @click="load">Retry</button>');
  });

  it('Create workflow 直接创建资源，归档提示没有空链接', () => {
    expect(shared).toContain('await api.workflows.create({');
    expect(shared).not.toContain('href="#"');
    expect(shared).toContain('Archived workflows are hidden in this view.');
  });
});
