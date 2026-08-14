import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AppServices } from '../app-services.js';

/**
 * 在 HTTP server 上挂 WS 端点：/ws?token=<jwt>&workflowId=<id>&projectId=<id>。
 * 鉴权、项目成员与工作流归属全部通过后，才加入对应 workflow 频道。
 */
export function attachWebSocket(
  server: Server,
  services: AppServices,
  options: { heartbeatIntervalMs?: number } = {},
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const reject = (socket: import('node:stream').Duplex, status: number, message: string) => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    let identity;
    try {
      identity = services.auth.verify(url.searchParams.get('token') ?? '');
    } catch {
      reject(socket, 401, 'Unauthorized');
      return;
    }
    const workflowId = url.searchParams.get('workflowId') ?? '';
    const projectId = url.searchParams.get('projectId') || identity.projectId;
    if (!workflowId) {
      reject(socket, 400, 'Bad Request');
      return;
    }
    void Promise.all([
      services.repos.projects.findMemberRole(projectId, identity.sub),
      services.workflows.getById(workflowId, projectId),
    ]).then(([role]) => {
      if (!role) {
        reject(socket, 403, 'Forbidden');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => services.pushHub.add(ws, workflowId));
    }).catch(() => reject(socket, 403, 'Forbidden'));
  });
  const heartbeat = setInterval(
    () => services.pushHub.heartbeat(),
    Math.max(25, options.heartbeatIntervalMs ?? 15_000),
  );
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
