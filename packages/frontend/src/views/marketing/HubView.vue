<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarketingPage from '../../components/marketing/MarketingPage.vue';
import { hubPages, type HubPage } from '../../lib/marketing-content.js';

/** 数据驱动的 Hub 页（Use cases / Docs / Community 聚合卡片）。按 route.path 取内容。 */
const route = useRoute();
const router = useRouter();

const fallback: HubPage = { title: 'Explore', sub: '', cards: [] };
const page = computed<HubPage>(() => hubPages[route.path] ?? fallback);
const go = (to?: string) => to && router.push(to);
</script>

<template>
  <MarketingPage>
    <section class="mkt-section mkt-center">
      <div class="mkt-wrap">
        <p v-if="page.eyebrow" class="mkt-eyebrow" style="margin-bottom: 18px">{{ page.eyebrow }}</p>
        <h1 class="mkt-h1">{{ page.title }} <span v-if="page.highlight" class="dim">{{ page.highlight }}</span></h1>
        <p class="mkt-sub">{{ page.sub }}</p>

        <div class="hub-grid">
          <button v-for="c in page.cards" :key="c.title" class="mkt-card mkt-card-link hub-card" @click="go(c.to)">
            <span v-if="c.icon" class="mkt-card-icon">{{ c.icon }}</span>
            <h3>{{ c.title }}</h3>
            <p>{{ c.desc }}</p>
            <span class="mkt-card-arrow">Learn more →</span>
          </button>
        </div>
      </div>
    </section>
  </MarketingPage>
</template>

<style scoped>
.hub-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 48px; text-align: left; }
.hub-card { align-items: flex-start; }
@media (max-width: 900px) {
  .hub-grid { grid-template-columns: 1fr; }
}
@media (min-width: 901px) and (max-width: 1100px) {
  .hub-grid { grid-template-columns: 1fr 1fr; }
}
</style>
