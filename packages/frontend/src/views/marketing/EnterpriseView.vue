<script setup lang="ts">
import { useRouter } from 'vue-router';
import MarketingPage from '../../components/marketing/MarketingPage.vue';

/** Enterprise 页（bespoke）。治理能力对齐 nomops 实际企业功能（SSO/LDAP/SCIM/RBAC/审计日志/日志流/外部密钥）。 */
const router = useRouter();
const go = (to: string) => router.push(to);

const pillars = [
  { icon: '🔒', h: 'Security & control', p: 'Fully on-prem option, SSO via SAML, LDAP and SCIM provisioning, encrypted secret stores and RBAC permissions.' },
  { icon: '📈', h: 'Observability', p: 'Audit logs and log streaming to your SIEM, workflow history, real-time alerts and usage dashboards.' },
  { icon: '🧑‍💻', h: 'Developer experience', p: 'Isolated environments, multi-user editing, workflow diffs and a version-controlled deployment flow.' },
  { icon: '🛡️', h: 'AI governance', p: 'Human-in-the-loop approvals, structured guardrails and native evaluations to keep AI actions contained.' },
];
</script>

<template>
  <MarketingPage>
    <!-- Hero -->
    <section class="mkt-hero">
      <div class="mkt-wrap">
        <p class="mkt-eyebrow" style="margin-bottom: 18px">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg>
          Enterprise
        </p>
        <h1 class="mkt-h1" style="max-width: 16em">Reliable. Scalable. <span class="dim">Secure.</span></h1>
        <p class="mkt-lead" style="max-width: 42em">Deploy on your infra or ours. Push workflows to production with the DevOps experience teams trust. nomops's security and governance features let you build, monitor and scale agents without losing control.</p>
        <div class="mkt-hero-cta">
          <button class="mkt-btn mkt-btn-accent mkt-btn-lg" @click="go('/signup')">Get started</button>
          <button class="mkt-btn mkt-btn-ghost mkt-btn-lg" @click="go('/pricing')">See pricing</button>
        </div>
      </div>
    </section>

    <!-- Pillars -->
    <section class="mkt-section-sm">
      <div class="mkt-wrap">
        <div class="pillars">
          <div v-for="p in pillars" :key="p.h" class="mkt-card">
            <span class="mkt-card-icon">{{ p.icon }}</span>
            <h3>{{ p.h }}</h3>
            <p>{{ p.p }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Deploy -->
    <section class="mkt-section">
      <div class="mkt-wrap deploy">
        <div>
          <h2 class="mkt-h2"><span class="b">Runs where you decide</span></h2>
          <p class="mkt-lead">Keep sensitive data inside your perimeter with a fully self-hosted deployment, or let us run it. Same platform, your choice — no lock-in.</p>
          <ul class="mkt-checks" style="margin-top: 22px">
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Self-host with Docker</b> — data never leaves your infra</span></li>
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Full source access</b> under our fair-code license</span></li>
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Queue mode</b> with workers to scale executions horizontally</span></li>
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Postgres-ready</b> for production workloads</span></li>
          </ul>
        </div>
        <div class="mkt-visual" style="min-height: 320px">
          <div class="deploy-icons">
            <span class="di">🐳</span><span class="di">🔒</span><span class="di">🗄️</span><span class="di">⚙️</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Trust quote -->
    <section class="mkt-section-sm">
      <div class="mkt-wrap quote">
        <blockquote>“nomops gives us SOAR-style orchestration in a low-code model, with room to code the complex parts — and every run is auditable.”</blockquote>
        <p class="quote-by"><b>Cyber Operations Lead</b> · Illustrative example</p>
      </div>
    </section>

    <!-- CTA -->
    <section class="mkt-cta-band">
      <div class="mkt-wrap mkt-center">
        <h2 class="mkt-h2"><span class="b">Bring nomops to your organization</span></h2>
        <p class="mkt-sub">Talk to us about deployment, security review and rollout.</p>
        <div class="mkt-hero-cta" style="justify-content: center; margin-top: 26px">
          <button class="mkt-btn mkt-btn-accent mkt-btn-lg" @click="go('/signup')">Get started</button>
          <button class="mkt-btn mkt-btn-ghost mkt-btn-lg" @click="go('/community/support')">Talk to sales</button>
        </div>
      </div>
    </section>
  </MarketingPage>
</template>

<style scoped>
.pillars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.deploy { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; align-items: center; }
.deploy-icons { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.di { width: 84px; height: 84px; border-radius: 18px; background: var(--mkt-panel2); border: 1px solid var(--mkt-border2); display: flex; align-items: center; justify-content: center; font-size: 38px; }
.quote { max-width: 820px; text-align: center; }
.quote blockquote { margin: 0; font-size: clamp(20px, 2.6vw, 28px); font-weight: 500; color: var(--mkt-head); line-height: 1.4; letter-spacing: -0.01em; }
.quote-by { margin: 18px 0 0; color: var(--mkt-faint); font-size: 14px; }
.quote-by b { color: var(--mkt-text); font-weight: 600; }

@media (max-width: 900px) {
  .pillars { grid-template-columns: 1fr 1fr; }
  .deploy { grid-template-columns: 1fr; gap: 34px; }
}
</style>
