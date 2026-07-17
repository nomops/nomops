<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useProjectsStore } from '../stores/projects.js';

/**
 * Admin Panel（账户/实例管理台）：实例概览 + 用量 + 套餐计费 + 成员。
 * 数据分别取（部分需 owner/admin，非管理员优雅降级）。
 */
const router = useRouter();
const projects = useProjectsStore();

const about = ref<Awaited<ReturnType<typeof api.about>> | null>(null);
const me = ref<Awaited<ReturnType<typeof api.me>> | null>(null);
const security = ref<Awaited<ReturnType<typeof api.security>> | null>(null);
const users = ref<Awaited<ReturnType<typeof api.instanceUsers.list>>>([]);
const usage = ref<{ used: number; limit: number | null; plan: string } | null>(null);
const usersDenied = ref(false);

onMounted(async () => {
  await projects.fetch().catch(() => undefined);
  const [aboutR, meR, secR, usersR] = await Promise.allSettled([
    api.about(),
    api.me(),
    api.security(),
    api.instanceUsers.list(),
  ]);
  if (aboutR.status === 'fulfilled') about.value = aboutR.value;
  if (meR.status === 'fulfilled') me.value = meR.value;
  if (secR.status === 'fulfilled') security.value = secR.value;
  if (usersR.status === 'fulfilled') users.value = usersR.value;
  else usersDenied.value = true;

  const current = projects.current;
  if (current) usage.value = await api.projects.usage(current.id).catch(() => null);
});

const isEnterprise = computed(() => (about.value?.plan ?? projects.license?.plan) === 'enterprise');
const planLabel = computed(() => (isEnterprise.value ? 'Enterprise' : 'Community'));
const memberCount = computed<string>(() => {
  if (security.value) return String(security.value.userCount);
  if (users.value.length) return String(users.value.length);
  return '–';
});

/** 用量进度（0–100）；无限额 → null。 */
const usagePct = computed(() => {
  const u = usage.value;
  if (!u || u.limit === null || u.limit === 0) return null;
  return Math.min(100, Math.round((u.used / u.limit) * 100));
});
const usageText = computed(() => {
  const u = usage.value;
  if (!u) return '–';
  return `${u.used} / ${u.limit === null ? 'Unlimited' : u.limit}`;
});

const summaryCards = computed(() => [
  { label: 'Plan', value: planLabel.value, accent: isEnterprise.value },
  { label: 'Members', value: String(memberCount.value) },
  { label: 'Executions this month', value: usage.value ? usageText.value : '–' },
  { label: 'Version', value: about.value ? `v${about.value.version}` : '–' },
]);

const roleLabel: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const enterpriseFeatures = computed(() => projects.license?.features ?? []);
</script>

<template>
  <div class="page-wrap" data-test="admin-panel">
    <div class="admin-head">
      <div>
        <h1 class="page-title">Admin Panel</h1>
        <p class="sub">Manage your instance, plan and members.</p>
      </div>
      <button v-if="!isEnterprise" class="btn primary" data-test="admin-upgrade" @click="router.push({ name: 'settings', query: { s: 'billing' } })">
        Upgrade plan
      </button>
    </div>

    <!-- 概览卡 -->
    <div class="summary">
      <div v-for="c in summaryCards" :key="c.label" class="sum-card">
        <div class="sum-label">{{ c.label }}</div>
        <div class="sum-value" :class="{ accent: c.accent }">{{ c.value }}</div>
      </div>
    </div>

    <div class="admin-grid">
      <!-- 实例概览 -->
      <div class="card admin-card">
        <h3 class="card-title">Instance</h3>
        <div class="kv"><span class="k">Name</span><span class="v">{{ about?.name ?? 'nomops' }}</span></div>
        <div class="kv"><span class="k">Version</span><span class="v">v{{ about?.version ?? '…' }}</span></div>
        <div class="kv"><span class="k">Plan</span><span class="v"><span class="plan-badge" :class="{ enterprise: isEnterprise }">{{ planLabel }}</span></span></div>
        <div class="kv"><span class="k">Status</span><span class="v ok">● Running</span></div>
        <div class="kv"><span class="k">Built-in nodes</span><span class="v">{{ about?.nodeCount ?? '–' }}</span></div>
        <div class="kv"><span class="k">SSO</span><span class="v">{{ security?.sso.enabled ? 'Enabled' : 'Disabled' }}</span></div>
      </div>

      <!-- 套餐与用量 -->
      <div class="card admin-card">
        <h3 class="card-title">Plan &amp; usage</h3>
        <div class="plan-row">
          <div>
            <div class="dim" style="font-size: 12px">Current plan</div>
            <div class="plan-name">{{ planLabel }}</div>
          </div>
          <span style="flex: 1" />
          <button v-if="!isEnterprise" class="btn primary" @click="router.push({ name: 'settings', query: { s: 'billing' } })">Upgrade</button>
        </div>

        <div class="usage-block">
          <div class="usage-top">
            <span class="dim" style="font-size: 12px">Executions this month</span>
            <span class="tnum" style="font-size: 13px">{{ usageText }}</span>
          </div>
          <div v-if="usagePct !== null" class="usage-bar"><span class="usage-fill" :style="{ width: usagePct + '%' }" /></div>
          <div v-else class="dim" style="font-size: 12px; margin-top: 6px">Unlimited executions on this plan.</div>
        </div>

        <div v-if="isEnterprise && enterpriseFeatures.length" class="features">
          <div class="dim" style="font-size: 12px; margin-bottom: 6px">Enabled enterprise features</div>
          <div class="feat-tags">
            <code v-for="f in enterpriseFeatures" :key="f" class="feat">{{ f }}</code>
          </div>
        </div>
      </div>
    </div>

    <!-- 成员 -->
    <div class="card admin-card" style="margin-top: 16px">
      <div class="card-title-row">
        <h3 class="card-title" style="margin: 0">Members</h3>
        <span style="flex: 1" />
        <button class="btn secondary" data-test="admin-manage-users" @click="router.push({ name: 'settings', query: { s: 'users' } })">
          Manage users
        </button>
      </div>
      <p v-if="usersDenied" class="dim" style="font-size: 13px; margin: 10px 0 0">
        Member management requires an owner or admin role.
      </p>
      <table v-else class="admin-table" data-test="admin-users">
        <thead>
          <tr><th>Email</th><th>Instance role</th><th>Status</th><th>Joined</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="email">
              {{ u.email }}
              <span v-if="me && u.id === me.id" class="you-tag">You</span>
            </td>
            <td>{{ roleLabel[u.role] ?? u.role }}</td>
            <td class="dim">{{ u.disabled ? 'Disabled' : 'Active' }}</td>
            <td class="dim">{{ new Date(u.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page-wrap { padding: 22px 26px 40px; width: 100%; }
.admin-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
.page-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; color: var(--text-hi); }
.sub { margin: 4px 0 0; color: var(--text-dim); font-size: 14px; }
.admin-head .btn { margin-left: auto; }
.btn {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px;
  border-radius: var(--radius); border: none; font-size: 14px; font-weight: 500; cursor: pointer;
  white-space: nowrap; font-family: inherit; color: var(--text-hi);
}
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-dim); }
.btn.secondary { background: var(--bg-panel); border: 1px solid var(--border); }
.btn.secondary:hover { border-color: var(--border-strong); }

.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
.sum-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; padding: 16px 18px 18px; }
.sum-label { font-size: 14px; color: var(--text); }
.sum-value { font-size: 26px; font-weight: 600; color: var(--text-hi); margin-top: 12px; letter-spacing: -0.4px; line-height: 1; }
.sum-value.accent { color: var(--accent); }

.admin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.admin-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; }
.card-title { margin: 0 0 14px; font-size: 15px; font-weight: 600; color: var(--text-hi); }
.card-title-row { display: flex; align-items: center; margin-bottom: 6px; }

.kv { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.kv:last-child { border-bottom: none; }
.kv .k { color: var(--text-dim); }
.kv .v { color: var(--text); }
.kv .v.ok { color: var(--ok); }
.plan-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--border); color: var(--text-dim); }
.plan-badge.enterprise { color: var(--accent); border-color: var(--accent); }

.plan-row { display: flex; align-items: center; gap: 12px; }
.plan-name { font-size: 18px; font-weight: 600; color: var(--text-hi); margin-top: 2px; }
.usage-block { margin-top: 18px; }
.usage-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.usage-bar { height: 8px; border-radius: 6px; background: var(--bg); overflow: hidden; }
.usage-fill { display: block; height: 100%; background: var(--accent); border-radius: 6px; }
.tnum { font-variant-numeric: tabular-nums; color: var(--text); }
.features { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
.feat-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.feat { background: var(--bg-input); padding: 3px 8px; border-radius: 6px; font-size: 12px; color: var(--text); }

.admin-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
.admin-table th { text-align: left; font-size: 12px; font-weight: 500; color: var(--text-dim); padding: 8px 10px; border-bottom: 1px solid var(--border); }
.admin-table td { padding: 10px; font-size: 13px; border-bottom: 1px solid var(--border); }
.admin-table tr:last-child td { border-bottom: none; }
.admin-table .email { color: var(--text-hi); }
.you-tag { font-size: 10px; font-weight: 600; margin-left: 8px; padding: 1px 6px; border-radius: 8px; background: var(--bg-hover); color: var(--text-dim); }

@media (max-width: 1000px) {
  .summary { grid-template-columns: repeat(2, 1fr); }
  .admin-grid { grid-template-columns: 1fr; }
}
</style>
