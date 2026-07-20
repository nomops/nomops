<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from '@vue-flow/core';

/**
 * D076 对标基线:自定义连线——中点悬浮工具条(+ 插入节点 / 🗑 删除连线)。
 * 默认只画贝塞尔线;鼠标移到线上(或工具条上)时工具条浮出。
 */
const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  markerEnd?: string;
  style?: CSSProperties;
}>();

const emit = defineEmits<{ insert: [id: string]; remove: [id: string] }>();

const hovered = ref(false);

const bezier = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition ?? Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition ?? Position.Left,
  }),
);
const path = computed(() => bezier.value[0]);
const labelX = computed(() => bezier.value[1]);
const labelY = computed(() => bezier.value[2]);
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" :style="style" />
  <!-- 加宽的透明交互带:让细线也好悬停 -->
  <path
    :d="path"
    class="edge-hit"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  />
  <EdgeLabelRenderer>
    <div
      class="edge-tools"
      :class="{ on: hovered }"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      :data-test-edge-tools="id"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <button class="et-btn" title="Add node" :data-test-edge-insert="id" @click.stop="emit('insert', id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <button class="et-btn danger" title="Delete connection" :data-test-edge-remove="id" @click.stop="emit('remove', id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
/* 透明加宽交互带(不改视觉,只扩大命中区) */
.edge-hit { fill: none; stroke: transparent; stroke-width: 18px; pointer-events: stroke; cursor: pointer; }

.edge-tools {
  position: absolute; z-index: 8; display: flex; gap: 4px; padding: 2px;
  background: var(--color--background--light-3);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--radius);
  opacity: 0; pointer-events: none; transition: opacity 0.1s;
}
.edge-tools.on { opacity: 1; pointer-events: all; }
.et-btn {
  width: 20px; height: 20px; padding: 0; display: flex; align-items: center; justify-content: center;
  background: none; border: none; border-radius: var(--radius);
  color: var(--color--text--tint-1); cursor: pointer;
}
.et-btn svg { width: 12px; height: 12px; }
.et-btn:hover { background: var(--color--background--light-1); color: var(--color--text--shade-1); }
.et-btn.danger:hover { color: var(--color--danger); }
</style>
