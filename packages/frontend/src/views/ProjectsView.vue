<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type MemberRow } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import UiDialog from '../components/ui/UiDialog.vue';
import UiState from '../components/ui/UiState.vue';

const projects = useProjectsStore();
const ui = useUiStore();

/** projectId → 本月用量（owner 项目才拉，docs/08）。 */
const usageById = ref<Record<string, { used: number; limit: number | null; plan: string }>>({});

const newName = ref('');
const error = ref('');
const loading = ref(true);
const createOpen = ref(false);
const creating = ref(false);
const expandedId = ref<string | null>(null);
const members = ref<MemberRow[]>([]);
const memberEmail = ref('');
const memberRole = ref('project:editor');

onMounted(async () => {
  try {
    await projects.fetch();
    await loadUsage();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

async function loadUsage() {
  const owned = projects.projects.filter((p) => p.role === 'project:owner');
  const results = await Promise.allSettled(owned.map((p) => api.projects.usage(p.id)));
  const next: typeof usageById.value = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') next[owned[i]!.id] = r.value;
  });
  usageById.value = next;
}

function usageLabel(projectId: string): string {
  const usage = usageById.value[projectId];
  if (!usage) return '–';
  return usage.limit === null ? `${usage.used} / unlimited` : `${usage.used} / ${usage.limit}`;
}

async function createProject() {
  const name = newName.value.trim();
  if (!name || creating.value) return;
  error.value = '';
  creating.value = true;
  try {
    await projects.createProject(name);
    newName.value = '';
    createOpen.value = false;
    await loadUsage();
    ui.notify({ kind: 'success', title: 'Project created', message: name });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    creating.value = false;
  }
}

async function toggleMembers(projectId: string) {
  error.value = '';
  if (expandedId.value === projectId) {
    expandedId.value = null;
    return;
  }
  try {
    members.value = await api.projects.members(projectId);
    expandedId.value = projectId;
  } catch (e) {
    error.value = (e as Error).message; // 非 owner / 社区版 → 后端 403
  }
}

async function addMember() {
  if (!expandedId.value) return;
  error.value = '';
  try {
    await api.projects.addMember(expandedId.value, memberEmail.value, memberRole.value);
    members.value = await api.projects.members(expandedId.value);
    memberEmail.value = '';
    ui.notify({ kind: 'success', title: 'Project member added' });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function changeRole(userId: string, event: Event) {
  if (!expandedId.value) return;
  error.value = '';
  try {
    await api.projects.updateMember(expandedId.value, userId, (event.target as HTMLSelectElement).value);
    members.value = await api.projects.members(expandedId.value);
    ui.notify({ kind: 'success', title: 'Member role updated' });
  } catch (e) {
    error.value = (e as Error).message;
    members.value = await api.projects.members(expandedId.value);
  }
}

async function removeMember(userId: string) {
  if (!expandedId.value) return;
  const member = members.value.find((item) => item.userId === userId);
  const confirmed = await ui.requestConfirm({
    title: 'Remove project member?',
    message: `${member?.email ?? 'This member'} will immediately lose access to this project.`,
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!confirmed) return;
  error.value = '';
  try {
    await api.projects.removeMember(expandedId.value, userId);
    members.value = await api.projects.members(expandedId.value);
    ui.notify({ kind: 'success', title: 'Project member removed', message: member?.email });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const roleLabel: Record<string, string> = {
  'project:owner': 'Owner',
  'project:editor': 'Editor',
  'project:viewer': 'Viewer',
};
</script>

<template>
  <div class="page-wrap">
    <!-- ── Header ── -->
    <div class="head">
      <h1>Projects</h1>
      <div class="head-actions">
        <template v-if="projects.hasFeature('rbac')">
          <button class="primary btn-new" data-test="create-project" @click="createOpen = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ic14"><path d="M12 5v14M5 12h14" /></svg>
            New project
          </button>
        </template>
        <span v-else class="upsell" data-test="rbac-upsell">
          Team projects and member management require an Enterprise license
        </span>
      </div>
    </div>

    <p v-if="error && projects.projects.length" class="error-text" role="alert" data-test="projects-error">{{ error }}</p>

    <!-- ── Table ── -->
    <UiState v-if="loading" kind="loading" title="Loading projects" description="Fetching your project access and monthly usage…" />
    <UiState v-else-if="error && !projects.projects.length" kind="error" title="Could not load projects" :description="error">
      <button class="primary" @click="$router.go(0)">Retry</button>
    </UiState>
    <UiState v-else-if="!projects.projects.length" title="No projects yet" description="Create a team project to organize workflows, credentials, and members.">
      <button v-if="projects.hasFeature('rbac')" class="primary" @click="createOpen = true">Create project</button>
    </UiState>
    <div v-else class="card projects-table-wrap" style="padding: 0">
      <table data-test="projects-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>My role</th>
            <th>Executions this month</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <template v-for="p in projects.projects" :key="p.id">
            <tr>
              <td>
                <span class="name-cell">
                  <svg v-if="p.type === 'personal'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="type-icon">
                    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="type-icon">
                    <circle cx="9" cy="8" r="3.2" /><path d="M2.5 19c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5" /><path d="M16 5.3a3.2 3.2 0 0 1 0 6" /><path d="M17.6 14.2c2.3.5 3.9 1.9 3.9 4.8" />
                  </svg>
                  {{ p.type === 'personal' ? 'Personal' : p.name }}
                </span>
              </td>
              <td class="dim">{{ p.type }}</td>
              <td>{{ roleLabel[p.role] ?? p.role }}</td>
              <td class="dim" :data-test-usage="p.id">{{ usageLabel(p.id) }}</td>
              <td style="text-align: right">
                <button
                  v-if="projects.hasFeature('rbac') && p.role === 'project:owner'"
                  :data-test-members="p.id"
                  @click="toggleMembers(p.id)"
                >
                  {{ expandedId === p.id ? 'Hide members' : 'Manage members' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedId === p.id">
              <td colspan="5">
                <div class="members-panel" data-test="members-panel">
                  <table class="members-table">
                    <tbody>
                      <tr v-for="m in members" :key="m.userId">
                        <td>{{ m.email }}</td>
                        <td style="width: 140px">
                          <select :value="m.role" @change="changeRole(m.userId, $event)">
                            <option value="project:owner">Owner</option>
                            <option value="project:editor">Editor</option>
                            <option value="project:viewer">Viewer</option>
                          </select>
                        </td>
                        <td style="width: 90px; text-align: right">
                          <button @click="removeMember(m.userId)">Remove</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="add-row">
                    <input v-model="memberEmail" placeholder="Member email" data-test="member-email" />
                    <select v-model="memberRole" class="add-role">
                      <option value="project:editor">Editor</option>
                      <option value="project:viewer">Viewer</option>
                      <option value="project:owner">Owner</option>
                    </select>
                    <button class="primary" data-test="add-member" @click="addMember">Add</button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <UiDialog :open="createOpen" title="Create team project" description="Projects keep workflows, credentials, and access separate." width="440px" test-id="projects-create-dialog" @close="createOpen = false">
      <label class="dialog-label" for="project-name-input">Project name</label>
      <input id="project-name-input" v-model="newName" class="dialog-input" placeholder="Team project name" data-test="new-project-name" autofocus @keyup.enter="createProject" />
      <template #footer>
        <button @click="createOpen = false">Cancel</button>
        <button class="primary" data-test="create-project-submit" :disabled="!newName.trim() || creating" @click="createProject">{{ creating ? 'Creating…' : 'Create project' }}</button>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }

/* Header */
.head { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
.head h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.head-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.btn-new { display: inline-flex; align-items: center; gap: 6px; }
.upsell { font-size: 12px; color: var(--text-faint); text-align: right; }

/* Table cells */
.name-cell { display: inline-flex; align-items: center; gap: 8px; color: var(--text-hi); }
.type-icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--text-dim); }
.ic14 { width: 14px; height: 14px; flex-shrink: 0; }

/* Member management panel */
.members-panel {
  background: var(--bg-input);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.members-table td { border-bottom: 1px solid var(--border); }
.members-table tr:last-child td { border-bottom: none; }
.add-row { display: flex; gap: 8px; margin-top: 12px; }
.add-role { width: 140px; }
.projects-table-wrap { overflow-x: auto; }
.projects-table-wrap > table { min-width: 720px; }
.dialog-label { display: block; margin-bottom: var(--spacing--2xs); color: var(--text-dim); font-size: var(--font-size--xs); }
.dialog-input { width: 100%; height: 36px; padding: 0 var(--spacing--xs); border: 1px solid var(--border); border-radius: var(--radius--2xs); background: var(--bg-input); color: var(--text-hi); font: inherit; }
.dialog-input:focus { outline: none; border-color: var(--accent); }

@media (max-width: 720px) {
  .page-wrap { padding: var(--spacing--sm); }
  .head { align-items: flex-start; }
  .upsell { max-width: 220px; }
  .add-row { flex-wrap: wrap; }
  .add-row input { flex: 1 1 100%; }
  .add-role { flex: 1; }
}
</style>
