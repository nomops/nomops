<script setup lang="ts">
/** 渲染 icons.ts 里的 SVG 字符串：尺寸由 size 控制，line 图标由 color 着色。 */
const props = withDefaults(defineProps<{ svg: string; color?: string; size?: number }>(), {
  size: 24,
});
</script>

<template>
  <span
    class="icon-svg"
    :style="{ width: `${props.size}px`, height: `${props.size}px`, color: color || undefined }"
    v-html="svg"
  />
</template>

<style scoped>
.icon-svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
