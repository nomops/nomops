import { defineStore } from 'pinia';
import type { IRunExecutionData } from '@nomops/workflow';
import { api, projectStorage, tokenStorage } from '../api/client.js';

interface PushEvent {
  type: 'executionStarted' | 'nodeExecuteBefore' | 'nodeExecuteAfter' | 'executionFinished';
  executionId: string;
  workflowId: string;
  nodeName?: string;
  status?: string;
  summary?: { itemCount?: number; executionTime?: number; error?: string };
}

interface HeartbeatEvent {
  type: 'heartbeat';
  timestamp: number;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 35_000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer);
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
    wsWorkflowId: null as string | null,
    wsConnected: false,
    wsReconnectAttempt: 0,
    wsGeneration: 0,
  }),
  actions: {
    connectWs(workflowId: string) {
      if (!workflowId) return;
      if (
        this.wsWorkflowId === workflowId
        && this.ws
        && this.ws.readyState <= WebSocket.OPEN
      ) return;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      if (this.ws) {
        this.wsGeneration += 1;
        const previous = this.ws;
        this.ws = null;
        previous.close();
      }
      this.wsWorkflowId = workflowId;
      this.wsReconnectAttempt = 0;
      this.openWs(workflowId);
    },

    openWs(workflowId: string) {
      if (this.wsWorkflowId !== workflowId) return;
      const token = tokenStorage.get();
      if (!token) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const query = new URLSearchParams({ token, workflowId });
      const projectId = projectStorage.get();
      if (projectId) query.set('projectId', projectId);
      const generation = ++this.wsGeneration;
      const ws = new WebSocket(`${proto}://${location.host}/ws?${query.toString()}`);
      ws.onopen = () => {
        if (generation !== this.wsGeneration) return;
        this.wsConnected = true;
        this.wsReconnectAttempt = 0;
        this.armHeartbeatWatchdog(generation, ws);
        void this.reconcileCurrentExecution();
      };
      ws.onmessage = (msg) => {
        if (generation !== this.wsGeneration) return;
        this.armHeartbeatWatchdog(generation, ws);
        try {
          const event = JSON.parse(String(msg.data)) as PushEvent | HeartbeatEvent;
          if (event.type !== 'heartbeat') this.handleEvent(event);
        } catch {
          // 畸形推送不应打断后续合法事件与重连状态机。
        }
      };
      ws.onclose = () => {
        if (generation !== this.wsGeneration) return;
        this.ws = null;
        this.wsConnected = false;
        clearTimer(heartbeatTimer);
        heartbeatTimer = null;
        this.scheduleReconnect(workflowId, generation);
      };
      this.ws = ws;
    },

    scheduleReconnect(workflowId: string, generation: number) {
      if (generation !== this.wsGeneration || this.wsWorkflowId !== workflowId || reconnectTimer) return;
      const delay = Math.min(RECONNECT_BASE_MS * (2 ** this.wsReconnectAttempt), RECONNECT_MAX_MS);
      this.wsReconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (generation === this.wsGeneration && this.wsWorkflowId === workflowId && !this.ws) this.openWs(workflowId);
      }, delay);
    },

    armHeartbeatWatchdog(generation: number, ws: WebSocket) {
      clearTimer(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        if (generation === this.wsGeneration) ws.close();
      }, HEARTBEAT_TIMEOUT_MS);
    },

    disconnectWs() {
      this.wsWorkflowId = null;
      this.wsConnected = false;
      this.wsReconnectAttempt = 0;
      this.wsGeneration += 1;
      clearTimer(reconnectTimer);
      clearTimer(heartbeatTimer);
      reconnectTimer = null;
      heartbeatTimer = null;
      const ws = this.ws;
      this.ws = null;
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
    },

    async reconcileCurrentExecution() {
      const id = this.currentExecutionId;
      if (!id) return;
      try {
        const detail = await api.executions.get(id);
        if (!['success', 'error', 'canceled'].includes(detail.execution.status)) return;
        if (this.currentExecutionId !== id) return;
        this.running = false;
        this.currentExecutionId = null;
        this.lastExecutionId = id;
        this.lastRunData = detail.data;
      } catch {
        // 重连校准失败不清本地状态；后续事件或下一次重连仍可恢复。
      }
    },

    handleEvent(event: PushEvent) {
      if (this.wsWorkflowId && event.workflowId !== this.wsWorkflowId) return;
      if (event.type !== 'executionStarted' && event.executionId !== this.currentExecutionId) return;
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
