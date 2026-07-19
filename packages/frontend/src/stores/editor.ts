import { defineStore } from 'pinia';
import type { IConnections, INode } from '@nomops/workflow';
import { api, type NodeTypeInfo } from '../api/client.js';
import {
  addConnection,
  removeConnection,
  removeNodeFromConnections,
  uniqueNodeName,
} from '../lib/workflow-convert.js';

/** undo/redo 快照（图定义 = 节点+连接；选中态/开关不入栈）。 */
interface IEditorSnapshot {
  nodes: INode[];
  connections: IConnections;
}

const MAX_HISTORY = 50;

/**
 * 画布编辑器：真源是契约格式（INode[] + IConnections），
 * Vue Flow 只是它的视图投影。保存时原样 PATCH 给后端。
 * undo/redo：每次图变更前压入快照（上限 50），Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z。
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
    favorite: false,
    dirty: false,
    saving: false,
    /* 发布/草稿分离：生产跑已发布版本 */
    publishedAt: null as string | null,
    /** 草稿领先于已发布版本（或从未发布）→ 显示 Publish 可用态。 */
    publishedDirty: true,
    publishing: false,
    loadError: null as string | null,
    /* C9 Focus panel：钉住的节点参数（会话态，不落库）。 */
    focusPanelOpen: false,
    pinnedParams: [] as Array<{ nodeName: string; paramName: string }>,
    undoStack: [] as IEditorSnapshot[],
    redoStack: [] as IEditorSnapshot[],
    /** 同一编辑串（如同一参数连续打字）只入一次栈的去抖标签。 */
    lastHistoryTag: null as string | null,
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
        this.favorite = Boolean(wf.favorite);
        this.publishedAt = wf.publishedAt ?? null;
        this.publishedDirty = wf.publishedDirty ?? true;
        this.selectedNodeName = null;
        this.ndvOpen = false;
        this.dirty = false;
        this.undoStack = [];
        this.redoStack = [];
        this.lastHistoryTag = null;
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
        this.publishedDirty = true; // 保存只改草稿；生产要等 Publish
      } finally {
        this.saving = false;
      }
    },

    /** 发布：草稿快照上生产（激活中的工作流同步重注册触发器）。 */
    async publish() {
      if (!this.id || this.publishing) return;
      this.publishing = true;
      try {
        if (this.dirty) await this.save(); // 先落草稿，发布的才是画布上看到的
        const res = await api.workflows.publish(this.id);
        this.publishedAt = res.publishedAt;
        this.publishedDirty = false;
      } finally {
        this.publishing = false;
      }
    },

    /* ── undo/redo ── */

    /**
     * 图变更前调用：当前状态入 undo 栈，清空 redo 分叉。
     * tag：同一编辑串去抖——连续同 tag 调用只有首次入栈（如同一参数连续打字算一次撤销）。
     */
    pushHistory(tag?: string) {
      if (tag && tag === this.lastHistoryTag) return;
      this.lastHistoryTag = tag ?? null;
      this.undoStack.push({
        nodes: JSON.parse(JSON.stringify(this.nodes)) as INode[],
        connections: JSON.parse(JSON.stringify(this.connections)) as IConnections,
      });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    },

    undo() {
      const snapshot = this.undoStack.pop();
      if (!snapshot) return;
      this.lastHistoryTag = null;
      this.redoStack.push({
        nodes: JSON.parse(JSON.stringify(this.nodes)) as INode[],
        connections: JSON.parse(JSON.stringify(this.connections)) as IConnections,
      });
      this.nodes = snapshot.nodes;
      this.connections = snapshot.connections;
      if (this.selectedNodeName && !this.nodes.some((n) => n.name === this.selectedNodeName)) {
        this.selectedNodeName = null;
        this.ndvOpen = false;
      }
      this.dirty = true;
    },

    redo() {
      const snapshot = this.redoStack.pop();
      if (!snapshot) return;
      this.lastHistoryTag = null;
      this.undoStack.push({
        nodes: JSON.parse(JSON.stringify(this.nodes)) as INode[],
        connections: JSON.parse(JSON.stringify(this.connections)) as IConnections,
      });
      this.nodes = snapshot.nodes;
      this.connections = snapshot.connections;
      this.dirty = true;
    },

    /** 从节点面板加节点。position 缺省时错落排布，避免重叠。 */
    addNode(desc: NodeTypeInfo, position?: [number, number]) {
      this.pushHistory();
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
        // 直接改连接表（addNode 已入栈一次，内部连线不重复入栈）
        this.connections = addConnection(this.connections, {
          source: from.name, sourceIndex: 0, target: name, targetIndex: 0,
        });
      }
      this.selectedNodeName = name;
      this.dirty = true;
      return node;
    },

    removeNode(name: string) {
      this.pushHistory();
      this.nodes = this.nodes.filter((n) => n.name !== name);
      this.connections = removeNodeFromConnections(this.connections, name);
      if (this.selectedNodeName === name) this.selectedNodeName = null;
      this.pinnedParams = this.pinnedParams.filter((p) => p.nodeName !== name);
      this.dirty = true;
    },

    /** 悬停工具条「⏻ Deactivate/Activate」：切换节点禁用态(引擎跳过 disabled 节点、直通输入)。 */
    toggleDisabled(name: string) {
      const node = this.nodes.find((n) => n.name === name);
      if (!node) return;
      this.pushHistory();
      node.disabled = !node.disabled;
      this.dirty = true;
    },

    /** 悬停工具条「⋯ → Duplicate」：克隆节点(新 id/唯一名/偏移落位、深拷参数、不带连线)。 */
    duplicateNode(name: string) {
      const src = this.nodes.find((n) => n.name === name);
      if (!src) return;
      this.pushHistory();
      const copy: INode = {
        ...JSON.parse(JSON.stringify(src)) as INode,
        id: crypto.randomUUID(),
        name: uniqueNodeName(src.name, this.nodes.map((n) => n.name)),
        position: [src.position[0] + 96 + 32, src.position[1] + 32], // n8n 式右下偏移
      };
      this.nodes.push(copy);
      this.selectedNodeName = copy.name;
      this.dirty = true;
      return copy;
    },

    /** 右键菜单「Rename」:改名并重写连接(源 key + 目标 endpoint)、pins、选中态。 */
    renameNode(oldName: string, newName: string) {
      const node = this.nodes.find((n) => n.name === oldName);
      const trimmed = newName.trim();
      if (!node || !trimmed || trimmed === oldName) return;
      const unique = uniqueNodeName(trimmed, this.nodes.filter((n) => n.name !== oldName).map((n) => n.name));
      this.pushHistory();
      node.name = unique;
      const next: IConnections = {};
      for (const [src, byType] of Object.entries(this.connections)) {
        const rewritten: IConnections[string] = {};
        for (const [type, outs] of Object.entries(byType)) {
          rewritten[type] = outs.map((eps) => (eps ? eps.map((e) => (e.node === oldName ? { ...e, node: unique } : e)) : eps));
        }
        next[src === oldName ? unique : src] = rewritten;
      }
      this.connections = next;
      this.pinnedParams = this.pinnedParams.map((p) => (p.nodeName === oldName ? { ...p, nodeName: unique } : p));
      if (this.selectedNodeName === oldName) this.selectedNodeName = unique;
      this.dirty = true;
    },

    /** Focus panel：钉/取钉参数；钉入时自动展开面板。 */
    togglePinParam(nodeName: string, paramName: string) {
      const idx = this.pinnedParams.findIndex((p) => p.nodeName === nodeName && p.paramName === paramName);
      if (idx >= 0) this.pinnedParams.splice(idx, 1);
      else {
        this.pinnedParams.push({ nodeName, paramName });
        this.focusPanelOpen = true;
      }
    },
    isParamPinned(nodeName: string, paramName: string): boolean {
      return this.pinnedParams.some((p) => p.nodeName === nodeName && p.paramName === paramName);
    },

    moveNode(name: string, position: [number, number]) {
      const node = this.nodes.find((n) => n.name === name);
      if (!node) return;
      this.pushHistory(); // drag-stop 每次一发，无需去抖；每次拖动=一步撤销
      node.position = position;
      this.dirty = true;
    },

    connect(args: { source: string; sourceIndex: number; target: string; targetIndex: number; type?: string }) {
      this.pushHistory();
      this.connections = addConnection(this.connections, args);
      this.dirty = true;
    },

    disconnect(args: { source: string; sourceIndex: number; target: string; targetIndex: number; type?: string }) {
      this.pushHistory();
      this.connections = removeConnection(this.connections, args);
      this.dirty = true;
    },

    setParam(nodeName: string, key: string, value: unknown) {
      const node = this.nodes.find((n) => n.name === nodeName);
      if (!node) return;
      this.pushHistory(`param:${nodeName}:${key}`);
      node.parameters = { ...node.parameters, [key]: value };
      this.dirty = true;
    },

    /** NDV 凭证选择器:设置/清除节点某凭证类型的绑定(node.credentials[type])。 */
    setNodeCredential(nodeName: string, credType: string, value: { id: string; name: string } | null) {
      const node = this.nodes.find((n) => n.name === nodeName);
      if (!node) return;
      this.pushHistory(`cred:${nodeName}:${credType}`);
      const creds = { ...(node.credentials ?? {}) };
      if (value) creds[credType] = value;
      else delete creds[credType];
      node.credentials = creds;
      this.dirty = true;
    },

    /** 节点级设置(NDV Settings tab):onError 与引擎消费的 continueOnError 保持同步。 */
    setNodeSetting(nodeName: string, key: keyof INode, value: unknown) {
      const node = this.nodes.find((n) => n.name === nodeName);
      if (!node) return;
      this.pushHistory(`setting:${nodeName}:${String(key)}`);
      (node as Record<string, unknown>)[key as string] = value;
      if (key === 'onError') node.continueOnError = value === 'continueErrorOutput';
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

    /**
     * Tidy up（对标 n8n）：按连接拓扑分层自动布局。
     * 列 = 距根的最长路径深度，行 = 同列内保持原相对纵序；便签不参与（保持手动摆放）。
     */
    tidyUp() {
      const layoutNodes = this.nodes.filter((n) => n.type !== 'nomops.stickyNote');
      if (layoutNodes.length === 0) return;
      this.pushHistory();

      // 邻接表（任意输出类型都算边）
      const out = new Map<string, string[]>();
      const indegree = new Map<string, number>(layoutNodes.map((n) => [n.name, 0]));
      for (const [source, byType] of Object.entries(this.connections)) {
        if (!indegree.has(source)) continue;
        for (const branches of Object.values(byType)) {
          for (const branch of branches) {
            for (const conn of branch ?? []) {
              if (!indegree.has(conn.node)) continue;
              (out.get(source) ?? out.set(source, []).get(source)!).push(conn.node);
              indegree.set(conn.node, (indegree.get(conn.node) ?? 0) + 1);
            }
          }
        }
      }

      // 最长路径深度（Kahn 拓扑；环上节点兜底深度 0，不会死循环）
      const depth = new Map<string, number>(layoutNodes.map((n) => [n.name, 0]));
      const queue = layoutNodes.filter((n) => (indegree.get(n.name) ?? 0) === 0).map((n) => n.name);
      const remaining = new Map(indegree);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const next of out.get(cur) ?? []) {
          depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(cur) ?? 0) + 1));
          const left = (remaining.get(next) ?? 1) - 1;
          remaining.set(next, left);
          if (left === 0) queue.push(next);
        }
      }

      // 列内按原 y 序排布，保持用户的分支上下关系
      const columns = new Map<number, typeof layoutNodes>();
      for (const node of layoutNodes) {
        const d = depth.get(node.name) ?? 0;
        (columns.get(d) ?? columns.set(d, []).get(d)!).push(node);
      }
      const X0 = 80, Y0 = 120, DX = 280, DY = 170;
      for (const [d, nodes] of columns) {
        nodes.sort((a, b) => a.position[1] - b.position[1]);
        nodes.forEach((node, i) => {
          node.position = [X0 + d * DX, Y0 + i * DY];
        });
      }
      this.dirty = true;
    },

    /** 激活/停用（有未存改动才先保存——无脑 save 会把 publishedDirty 误置回 true）。 */
    async toggleActive() {
      if (!this.id) return;
      if (this.dirty) await this.save();
      const result = await api.workflows.activate(this.id, !this.active);
      this.active = result.active;
    },
  },
});
