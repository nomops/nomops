<script setup lang="ts">
import MarketingNav from './MarketingNav.vue';
import MarketingFooter from './MarketingFooter.vue';

/** 营销页外壳：.mkt 滚动容器 + 导航 + 内容(slot) + 页脚。 */
</script>

<template>
  <div class="mkt">
    <MarketingNav />
    <main>
      <slot />
    </main>
    <MarketingFooter />
  </div>
</template>
