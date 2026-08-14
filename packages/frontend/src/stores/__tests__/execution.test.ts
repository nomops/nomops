import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api, projectStorage, tokenStorage } from '../../api/client.js';
import { useExecutionStore } from '../execution.js';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  close(): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

let execution: ReturnType<typeof useExecutionStore>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  tokenStorage.set('test-token');
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  setActivePinia(createPinia());
  execution = useExecutionStore();
});

afterEach(() => {
  execution.disconnectWs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('execution WebSocket isolation and recovery', () => {
  it('subscribes with workflow and project context', () => {
    projectStorage.set('project-a');
    execution.connectWs('workflow-a');

    const url = new URL(FakeWebSocket.instances[0]!.url);
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('token')).toBe('test-token');
    expect(url.searchParams.get('workflowId')).toBe('workflow-a');
    expect(url.searchParams.get('projectId')).toBe('project-a');
  });

  it('ignores events from other workflows and executions', async () => {
    const getExecution = vi.spyOn(api.executions, 'get').mockResolvedValue({
      execution: {
        id: 'execution-a',
        workflowId: 'workflow-a',
        status: 'success',
        mode: 'manual',
        startedAt: null,
        stoppedAt: null,
        createdAt: new Date(0).toISOString(),
      },
      data: null,
      metadata: [],
    });
    execution.connectWs('workflow-a');

    execution.handleEvent({
      type: 'executionStarted', executionId: 'execution-a', workflowId: 'workflow-a',
    });
    execution.handleEvent({
      type: 'nodeExecuteBefore', executionId: 'execution-b', workflowId: 'workflow-a', nodeName: 'Wrong execution',
    });
    execution.handleEvent({
      type: 'nodeExecuteBefore', executionId: 'execution-a', workflowId: 'workflow-b', nodeName: 'Wrong workflow',
    });
    execution.handleEvent({
      type: 'nodeExecuteAfter', executionId: 'execution-a', workflowId: 'workflow-a', nodeName: 'Set', summary: {},
    });
    execution.handleEvent({
      type: 'executionFinished', executionId: 'execution-b', workflowId: 'workflow-a', status: 'success',
    });

    expect(execution.statusByNode).toEqual({ Set: 'success' });
    expect(execution.running).toBe(true);
    expect(execution.currentExecutionId).toBe('execution-a');
    expect(getExecution).not.toHaveBeenCalled();

    execution.handleEvent({
      type: 'executionFinished', executionId: 'execution-a', workflowId: 'workflow-a', status: 'success',
    });
    await vi.waitFor(() => expect(getExecution).toHaveBeenCalledWith('execution-a'));
    expect(execution.running).toBe(false);
    expect(execution.lastExecutionId).toBe('execution-a');
  });

  it('reconnects with exponential backoff after unexpected closes', () => {
    execution.connectWs('workflow-a');
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.close();

    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1]!.close();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('resets the heartbeat watchdog on messages and reconnects after silence', () => {
    execution.connectWs('workflow-a');
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    vi.advanceTimersByTime(34_999);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    socket.message({ type: 'heartbeat', timestamp: Date.now() });
    vi.advanceTimersByTime(34_999);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    vi.advanceTimersByTime(1);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect after an intentional disconnect', () => {
    execution.connectWs('workflow-a');
    FakeWebSocket.instances[0]!.open();
    execution.disconnectWs();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(execution.wsWorkflowId).toBeNull();
  });
});
