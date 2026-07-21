import { defineStore } from 'pinia';
import type { IRunExecutionData } from '@nomops/workflow';
import { api, tokenStorage } from '../api/client.js';

interface PushEvent {
  type: 'executionStarted' | 'nodeExecuteBefore' | 'nodeExecuteAfter' | 'executionFinished';
  executionId: string;
  workflowId: string;
  nodeName?: string;
  status?: string;
  summary?: { itemCount?: number; executionTime?: number; error?: string };
}

export type NodeRunStatus = 'running' | 'success' | 'error';

/**
 * 执行状态：WS 实时事件驱动节点高亮；executionFinished 后拉执行详情供数据视图。
 */
export const useExecutionStore = defineStore('execution', {
  state: () => ({
    running: false,
    /** 在跑执行的 id（executionStarted 事件携带）；画布 Stop 用它调 stop API。 */
    currentExecutionId: null as string | null,
    statusByNode: {} as Record<string, NodeRunStatus>,
    lastExecutionId: null as string | null,
    lastRunData: null as IRunExecutionData | null,
    runError: null as string | null,
    ws: null as WebSocket | null,
  }),
  actions: {
    connectWs() {
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
      const token = tokenStorage.get();
      if (!token) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
      ws.onmessage = (msg) => this.handleEvent(JSON.parse(String(msg.data)) as PushEvent);
      ws.onclose = () => {
        this.ws = null;
      };
      this.ws = ws;
    },

    handleEvent(event: PushEvent) {
      switch (event.type) {
        case 'executionStarted':
          this.statusByNode = {};
          this.running = true;
          this.currentExecutionId = event.executionId;
          break;
        case 'nodeExecuteBefore':
          if (event.nodeName) this.statusByNode[event.nodeName] = 'running';
          break;
        case 'nodeExecuteAfter':
          if (event.nodeName) {
            this.statusByNode[event.nodeName] = event.summary?.error ? 'error' : 'success';
          }
          break;
        case 'executionFinished':
          this.running = false;
          this.currentExecutionId = null;
          this.lastExecutionId = event.executionId;
          void this.fetchRunData(event.executionId);
          break;
      }
    },

    async fetchRunData(executionId: string) {
      const detail = await api.executions.get(executionId);
      this.lastRunData = detail.data;
    },

    /** 运行工作流；destinationNode 给定时只跑到该节点（NDV 的「Execute step」）。 */
    async run(workflowId: string, opts: { destinationNode?: string; startNode?: string } = {}) {
      this.runError = null;
      this.statusByNode = {};
      this.lastRunData = null;
      this.running = true;
      try {
        const summary = await api.workflows.run(workflowId, opts);
        if (summary.error) this.runError = summary.error;
      } catch (error) {
        this.runError = (error as Error).message;
        this.running = false;
      }
    },

    /** 停止在跑执行（画布 Stop execution）；收尾状态由 executionFinished 事件回推。 */
    async stop() {
      const id = this.currentExecutionId;
      if (!id) return;
      await api.executions.stop(id).catch(() => undefined);
    },

    reset() {
      this.statusByNode = {};
      this.lastRunData = null;
      this.runError = null;
      this.running = false;
      this.currentExecutionId = null;
    },
  },
});
