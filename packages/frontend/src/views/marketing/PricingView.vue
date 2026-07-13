<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import MarketingPage from '../../components/marketing/MarketingPage.vue';

/** Pricing 页（bespoke）。三档对齐 nomops 实际计费模型：自托管免费 / Pro / Enterprise。价格为示意占位。 */
const router = useRouter();
const annual = ref(true);
const go = (to: string) => router.push(to);

const tiers = [
  {
    name: 'Community',
    tagline: 'Self-host, free forever',
    priceMonthly: 0,
    priceAnnual: 0,
    unit: '',
    note: 'Run it on your own infrastructure',
    cta: { label: 'Deploy with Docker', to: '/docs/self-host' },
    highlight: false,
    features: [
      'Unlimited workflows & executions on your infra',
      'Full source code access',
      'Visual editor + code nodes',
      'Hundreds of integrations',
      'Community forum support',
    ],
  },
  {
    name: 'Pro',
    tagline: 'Hosted by us',
    priceMonthly: 24,
    priceAnnual: 20,
    unit: '/mo',
    note: 'Per project, billed ' + '{cycle}',
    cta: { label: 'Get started', to: '/signup' },
    highlight: true,
    features: [
      'Everything in Community',
      'We host and scale it for you',
      'Generous monthly execution quota',
      'Projects, roles & shared credentials',
      'Execution history & insights',
      'Email support',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'For teams at scale',
    priceMonthly: null,
    priceAnnual: null,
    unit: '',
    note: 'Custom pricing',
    cta: { label: 'Talk to sales', to: '/enterprise' },
    highlight: false,
    features: [
      'Everything in Pro',
      'SSO (SAML), LDAP & SCIM',
      'RBAC & granular permissions',
      'Audit logs & log streaming',
      'External secrets & governance',
      'Dedicated support & SLA',
    ],
  },
];

function price(t: (typeof tiers)[number]): string {
  const p = annual.value ? t.priceAnnual : t.priceMonthly;
  if (p === null) return 'Custom';
  if (p === 0) return '$0';
  return `$${p}`;
}
</script>

<template>
  <MarketingPage>
    <section class="mkt-section mkt-center">
      <div class="mkt-wrap">
        <p class="mkt-eyebrow" style="margin-bottom: 18px">Pricing</p>
        <h1 class="mkt-h1">Start free.<br><span class="dim">Scale when you're ready.</span></h1>
        <p class="mkt-sub">Self-host the whole platform at no cost, or let us run it. Upgrade for governance and support when your team needs it.</p>

        <div class="cycle" role="tablist" aria-label="Billing cycle">
          <button :class="{ on: !annual }" @click="annual = false">Monthly</button>
          <button :class="{ on: annual }" @click="annual = true">Annual <span class="save">-2 months</span></button>
        </div>

        <div class="tiers">
          <div v-for="t in tiers" :key="t.name" class="tier" :class="{ hot: t.highlight }">
            <div v-if="t.highlight" class="badge">Most popular</div>
            <h3 class="tier-name">{{ t.name }}</h3>
            <p class="tier-tag">{{ t.tagline }}</p>
            <div class="tier-price">
              <span class="amount">{{ price(t) }}</span><span v-if="t.unit && price(t) !== 'Custom'" class="unit">{{ t.unit }}</span>
            </div>
            <p class="tier-note">{{ t.note.replace('{cycle}', annual ? 'annually' : 'monthly') }}</p>
            <button class="mkt-btn" :class="t.highlight ? 'mkt-btn-accent' : 'mkt-btn-ghost'" @click="go(t.cta.to)">{{ t.cta.label }}</button>
            <ul class="tier-feats">
              <li v-for="f in t.features" :key="f">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg>
                <span>{{ f }}</span>
              </li>
            </ul>
          </div>
        </div>

        <p class="disclaimer">Prices are illustrative. Community edition is free to self-host under our fair-code license.</p>
      </div>
    </section>

    <section class="mkt-section-sm">
      <div class="mkt-wrap faq">
        <h2 class="mkt-h2 mkt-center" style="margin-bottom: 34px"><span class="b">Questions, answered</span></h2>
        <div class="faq-grid">
          <div class="faq-item"><h4>Is self-hosting really free?</h4><p>Yes. The Community edition runs on your own infrastructure at no cost under our fair-code license.</p></div>
          <div class="faq-item"><h4>What counts as an execution?</h4><p>One run of a workflow, whether triggered manually, on a schedule, or by a webhook.</p></div>
          <div class="faq-item"><h4>Can I move between plans?</h4><p>Upgrade or downgrade anytime. Self-hosted and hosted use the same platform.</p></div>
          <div class="faq-item"><h4>Do you offer discounts?</h4><p>Annual billing saves you two months. Talk to us about volume and non-profit pricing.</p></div>
        </div>
      </div>
    </section>

    <section class="mkt-cta-band">
      <div class="mkt-wrap mkt-center">
        <h2 class="mkt-h2"><span class="b">Ready to build?</span></h2>
        <p class="mkt-sub">Start free — no credit card required.</p>
        <button class="mkt-btn mkt-btn-accent mkt-btn-lg" style="margin-top: 26px" @click="go('/signup')">Get started for free</button>
      </div>
    </section>
  </MarketingPage>
</template>

<style scoped>
.cycle { display: inline-flex; gap: 4px; margin: 30px 0 8px; padding: 4px; border: 1px solid var(--mkt-border2); border-radius: 999px; background: var(--mkt-panel); }
.cycle button { padding: 8px 18px; border-radius: 999px; border: none; background: none; color: var(--mkt-dim); font-size: 14px; font-weight: 500; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 8px; }
.cycle button.on { background: var(--mkt-bg2); color: var(--mkt-text); }
.save { font-size: 11px; color: #64c98a; background: rgba(100, 201, 138, 0.12); padding: 2px 7px; border-radius: 999px; }

.tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 34px; text-align: left; align-items: start; }
.tier { position: relative; border: 1px solid var(--mkt-border); border-radius: 18px; background: var(--mkt-panel); padding: 30px; display: flex; flex-direction: column; gap: 8px; }
.tier.hot { border-color: rgba(255, 138, 76, 0.55); background: linear-gradient(180deg, rgba(255, 138, 76, 0.08), var(--mkt-panel) 46%); box-shadow: 0 20px 50px rgba(238, 70, 32, 0.14); }
.badge { position: absolute; top: -11px; left: 30px; background: var(--mkt-accent-grad); color: #fff; font-size: 11.5px; font-weight: 600; padding: 4px 12px; border-radius: 999px; }
.tier-name { margin: 0; font-size: 20px; font-weight: 600; color: #fff; }
.tier-tag { margin: 0; color: var(--mkt-dim); font-size: 14px; }
.tier-price { display: flex; align-items: baseline; gap: 4px; margin: 12px 0 2px; }
.tier-price .amount { font-size: 44px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
.tier-price .unit { color: var(--mkt-dim); font-size: 15px; }
.tier-note { margin: 0 0 16px; color: var(--mkt-faint); font-size: 13px; }
.tier .mkt-btn { width: 100%; }
.tier-feats { list-style: none; margin: 18px 0 0; padding: 18px 0 0; border-top: 1px solid var(--mkt-border); display: grid; gap: 12px; }
.tier-feats li { display: flex; gap: 10px; font-size: 14px; color: var(--mkt-dim); line-height: 1.45; }
.tier-feats svg { width: 17px; height: 17px; flex-shrink: 0; color: #64c98a; margin-top: 1px; }
.disclaimer { margin-top: 26px; font-size: 12.5px; color: var(--mkt-faint); }

.faq { max-width: 900px; }
.faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px 40px; text-align: left; }
.faq-item h4 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: #fff; }
.faq-item p { margin: 0; font-size: 14.5px; color: var(--mkt-dim); line-height: 1.55; }

@media (max-width: 900px) {
  .tiers, .faq-grid { grid-template-columns: 1fr; }
}
</style>
