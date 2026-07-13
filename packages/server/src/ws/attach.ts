import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AppServices } from '../app-services.js';

/**
 * 在 HTTP server 上挂 WS 端点：/ws?token=<jwt>。
 * 鉴权失败 401 断开；通过则纳入 PushHub 接收执行进度。
 */
export function attachWebSocket(server: Server, services: AppServices): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    try {
      services.auth.verify(url.searchParams.get('token') ?? '');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      services.pushHub.add(ws);
    });
  });
  return wss;
}
