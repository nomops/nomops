import { defineStore } from 'pinia';
import type { IConnections, INode } from '@nomops/workflow';
import { api, type NodeTypeInfo } from '../api/client.js';
import {
  addConnection,
  removeConnection,
  removeNodeFromConnections,
  uniqueNodeName,
} from '../lib/workflow-convert.js';

/**
 * 画布编辑器：真源是契约格式（INode[] + IConnections），
 * Vue Flow 只是它的视图投影。保存时原样 PATCH 给后端。
 */
export const useEditorStore = defineStore('editor', {
  state: () => ({
    id: null as string | null,
    name: 'My workflow',
    nodes: [] as INode[],
    connections: {} as IConnections,
    selectedNodeName: null as string | null,
    /** NDV 模态开关（双击节点打开）。 */
    ndvOpen: false,
    /** 节点选择器抽屉开关（右侧，点「+」或空态打开）。 */
    nodePickerOpen: false,
    active: false,
    dirty: false,
    saving: false,
    loadError: null as string | null,
  }),
  getters: {
    selectedNode(): INode | null {
      return this.nodes.find((n) => n.name === this.selectedNodeName) ?? null;
    },
  },
  actions: {
    async load(id: string) {
      this.loadError = null;
      try {
        const wf = await api.workflows.get(id);
        this.id = wf.id;
        this.name = wf.name;
        this.nodes = wf.nodes;
        this.connections = wf.connections;
        this.active = wf.active;
        this.selectedNodeName = null;
        this.ndvOpen = false;
        this.dirty = false;
      } catch (error) {
        this.loadError = (error as Error).message;
      }
    },

    async save() {
      if (!this.id) return;
      this.saving = true;
      try {
        await api.workflows.update(this.id, {
          name: this.name,
          nodes: this.nodes,
          connections: this.connections,
        });
        this.dirty = false;
      } finally {
        this.saving = false;
      }
    },

    /** 从节点面板加节点。position 缺省时错落排布，避免重叠。 */
    addNode(desc: NodeTypeInfo, position?: [number, number]) {
      const name = uniqueNodeName(desc.defaults.name, this.nodes.map((n) => n.name));
      const node: INode = {
        id: crypto.randomUUID(),
        name,
        type: desc.type,
        typeVersion: Array.isArray(desc.version) ? desc.version[desc.version.length - 1]! : desc.version,
        position: position ?? [80 + this.nodes.length * 220, 120 + (this.nodes.length % 3) * 40],
        parameters: {},
      };
      this.nodes.push(node);
      // 便捷连线：若当前有选中节点且新节点有输入口，自动从选中节点接一条
      const from = this.selectedNode;
      if (from && desc.inputs.length > 0) {
        this.connect({ source: from.name, sourceIndex: 0, target: name, targetIndex: 0 });
      }
      this.selectedNodeName = name;
      this.dirty = true;
      return node;
    },

    removeNode(name: string) {
      this.nodes = this.nodes.filter((n) => n.name !== name);
      this.connections = removeNodeFromConnections(this.connections, name);
      if (this.selectedNodeName === name) this.selectedNodeName = null;
      this.dirty = true;
    },

    moveNode(name: string, position: [number, number]) {
      const node = this.nodes.find((n) => n.name === name);
      if (!node) return;
      node.position = position;
      this.dirty = true;
    },

    connect(args: { source: string; sourceIndex: number; target: string; targetIndex: number }) {
      this.connections = addConnection(this.connections, args);
      this.dirty = true;
    },

    disconnect(args: { source: string; sourceIndex: number; target: string; targetIndex: number }) {
      this.connections = removeConnection(this.connections, args);
      this.dirty = true;
    },

    setParam(nodeName: string, key: string, value: unknown) {
      const node = this.nodes.find((n) => n.name === nodeName);
      if (!node) return;
      node.parameters = { ...node.parameters, [key]: value };
      this.dirty = true;
    },

    select(name: string | null) {
      this.selectedNodeName = name;
    },

    /** 双击节点：选中并打开 NDV。 */
    openNdv(name: string) {
      this.selectedNodeName = name;
      this.ndvOpen = true;
    },

    /** 激活/停用（先保存再激活，保证后端注册的是最新触发器配置）。 */
    async toggleActive() {
      if (!this.id) return;
      await this.save();
      const result = await api.workflows.activate(this.id, !this.active);
      this.active = result.active;
    },
  },
});
