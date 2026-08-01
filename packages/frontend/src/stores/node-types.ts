import { defineStore } from 'pinia';
import { api, type NodeTypeInfo } from '../api/client.js';

export const useNodeTypesStore = defineStore('nodeTypes', {
  state: () => ({
    descriptions: [] as NodeTypeInfo[],
    loaded: false,
    loading: false,
    error: '',
  }),
  getters: {
    /** 全名 type（nomops.* 或 <pkg>.*）→ 节点信息。 */
    byType(): Map<string, NodeTypeInfo> {
      return new Map(this.descriptions.map((d) => [d.type, d]));
    },
    /** 按 group 分组（trigger / transform / output…），供节点面板分类。 */
    grouped(): Array<{ group: string; items: NodeTypeInfo[] }> {
      const map = new Map<string, NodeTypeInfo[]>();
      for (const d of this.descriptions) {
        const g = d.group[0] ?? 'other';
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(d);
      }
      return [...map.entries()]
        .sort(([a], [b]) => (a === 'trigger' ? -1 : b === 'trigger' ? 1 : a.localeCompare(b)))
        .map(([group, items]) => ({ group, items }));
    },
  },
  actions: {
    async fetch(force = false) {
      if ((this.loaded && !force) || this.loading) return;
      this.loading = true;
      this.error = '';
      try {
        this.descriptions = await api.nodeTypes();
        this.loaded = true;
      } catch (error) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
  },
});
