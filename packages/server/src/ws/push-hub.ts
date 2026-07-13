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

/**
 * WS 推送枢纽：连接管理 + 广播。
 * 安装版单租户，MVP 广播给全部已鉴权连接；按 project 分频道是 Cloud 阶段的事。
 */
export class PushHub {
  private readonly sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
  }

  broadcast(event: IPushEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  get size(): number {
    return this.sockets.size;
  }
}
