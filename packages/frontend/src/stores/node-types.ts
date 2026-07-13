import { defineStore } from 'pinia';
import type { INodeTypeDescription } from '@nomops/workflow';
import { api } from '../api/client.js';

export const useNodeTypesStore = defineStore('nodeTypes', {
  state: () => ({
    descriptions: [] as INodeTypeDescription[],
    loaded: false,
  }),
  getters: {
    /** 全名（nomops.<name>）→ description。 */
    byType(): Map<string, INodeTypeDescription> {
      return new Map(this.descriptions.map((d) => [`nomops.${d.name}`, d]));
    },
    /** 按 group 分组（trigger / transform / output…），供节点面板分类。 */
    grouped(): Array<{ group: string; items: INodeTypeDescription[] }> {
      const map = new Map<string, INodeTypeDescription[]>();
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
    async fetch() {
      if (this.loaded) return;
      this.descriptions = await api.nodeTypes();
      this.loaded = true;
    },
  },
});
