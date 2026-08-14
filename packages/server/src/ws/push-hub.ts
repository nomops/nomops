import type { WebSocket } from 'ws';

/** 推给前端的执行进度事件。 */
export interface IPushEvent {
  type: 'executionStarted' | 'nodeExecuteBefore' | 'nodeExecuteAfter' | 'executionFinished';
  executionId: string;
  workflowId: string;
  nodeName?: string;
  status?: string;
  /** nodeExecuteAfter 附带该节点的输出摘要（item 数/耗时/是否出错）。 */
  summary?: { itemCount?: number; executionTime?: number; error?: string };
  timestamp: number;
}

export interface IHeartbeatEvent {
  type: 'heartbeat';
  timestamp: number;
}

export type IPushMessage = IPushEvent | IHeartbeatEvent;

interface ISocketState {
  workflowId: string;
  alive: boolean;
}

/**
 * WS 推送枢纽：连接管理 + workflow 频道广播 + 双向存活探测。
 */
export class PushHub {
  private readonly sockets = new Map<WebSocket, ISocketState>();

  add(socket: WebSocket, workflowId: string): void {
    this.sockets.set(socket, { workflowId, alive: true });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('pong', () => {
      const state = this.sockets.get(socket);
      if (state) state.alive = true;
    });
  }

  broadcast(event: IPushEvent): void {
    const payload = JSON.stringify(event);
    for (const [socket, state] of this.sockets) {
      if (state.workflowId === event.workflowId && socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  /**
   * 协议 ping 探测半开连接；应用 heartbeat 让浏览器端也能检测静默链路并主动重连。
   * 连续两轮未收到 pong 的 socket 直接终止。
   */
  heartbeat(timestamp = Date.now()): void {
    const payload = JSON.stringify({ type: 'heartbeat', timestamp } satisfies IHeartbeatEvent);
    for (const [socket, state] of this.sockets) {
      if (socket.readyState !== socket.OPEN) continue;
      if (!state.alive) {
        this.sockets.delete(socket);
        socket.terminate();
        continue;
      }
      state.alive = false;
      socket.ping();
      socket.send(payload);
    }
  }

  sizeFor(workflowId: string): number {
    return [...this.sockets.values()].filter((state) => state.workflowId === workflowId).length;
  }

  get size(): number {
    return this.sockets.size;
  }
}
