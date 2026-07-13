<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarketingPage from '../../components/marketing/MarketingPage.vue';
import { featurePages, type FeaturePage } from '../../lib/marketing-content.js';

/** 数据驱动的 Feature 页（Product / Use cases / Docs / Community 详情）。按 route.path 取内容。 */
const route = useRoute();
const router = useRouter();

const fallback: FeaturePage = {
  title: 'Coming soon',
  sub: 'This page is on the way. In the meantime, explore the product or start building.',
  primaryCta: { label: 'Get started for free', to: '/signup' },
  secondaryCta: { label: 'See the product', to: '/product' },
  sections: [],
};

const page = computed<FeaturePage>(() => featurePages[route.path] ?? fallback);
const go = (to: string) => router.push(to);
</script>

<template>
  <MarketingPage>
    <!-- Hero -->
    <section class="mkt-hero">
      <div class="mkt-wrap mkt-hero-grid">
        <div>
          <p v-if="page.eyebrow" class="mkt-eyebrow" style="margin-bottom: 18px">{{ page.eyebrow }}</p>
          <h1 class="mkt-h1">{{ page.title }} <span v-if="page.highlight" class="dim">{{ page.highlight }}</span></h1>
          <p class="mkt-lead">{{ page.sub }}</p>
          <div class="mkt-hero-cta">
            <button v-if="page.primaryCta" class="mkt-btn mkt-btn-accent mkt-btn-lg" @click="go(page.primaryCta.to)">{{ page.primaryCta.label }}</button>
            <button v-if="page.secondaryCta" class="mkt-btn mkt-btn-ghost mkt-btn-lg" @click="go(page.secondaryCta.to)">{{ page.secondaryCta.label }}</button>
          </div>
        </div>
        <div v-if="page.visual" class="mkt-visual">
          <div class="visual-icons">
            <span v-for="(g, i) in [...page.visual]" :key="i" class="vi">{{ g }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature sections -->
    <section v-if="page.sections.length" class="mkt-section">
      <div class="mkt-wrap">
        <div class="feat-grid" :class="{ 'is-two': page.sections.length % 2 === 0 && page.sections.length !== 3 }">
          <div v-for="s in page.sections" :key="s.h3" class="mkt-card">
            <h3>{{ s.h3 }}</h3>
            <p>{{ s.p }}</p>
            <ul v-if="s.checks" class="mkt-checks" style="margin-top: 6px">
              <li v-for="c in s.checks" :key="c">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg>
                <span>{{ c }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Closing CTA -->
    <section v-if="page.closing" class="mkt-cta-band">
      <div class="mkt-wrap mkt-center">
        <h2 class="mkt-h2"><span class="b">{{ page.closing.title }}</span></h2>
        <p class="mkt-sub">{{ page.closing.sub }}</p>
        <button class="mkt-btn mkt-btn-accent mkt-btn-lg" style="margin-top: 26px" @click="go(page.closing.cta.to)">{{ page.closing.cta.label }}</button>
      </div>
    </section>
  </MarketingPage>
</template>

<style scoped>
.feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.feat-grid.is-two { grid-template-columns: 1fr 1fr; }
.visual-icons { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.vi {
  width: 72px; height: 72px; border-radius: 16px; background: var(--mkt-panel2); border: 1px solid var(--mkt-border2);
  display: flex; align-items: center; justify-content: center; font-size: 32px;
}
@media (max-width: 900px) {
  .feat-grid, .feat-grid.is-two { grid-template-columns: 1fr; }
}
</style>
