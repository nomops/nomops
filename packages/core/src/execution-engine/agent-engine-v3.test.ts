import { describe, expect, it, vi } from 'vitest';
import type {
  IAiTool,
  IExecuteContext,
  IHttpRequestOptions,
  ILoadableNodeType,
  INode,
  INodeType,
  ISupplyDataContext,
  JsonObject,
} from '@nomops/workflow';
import {
  AI_TOOL_RESULTS_CONTEXT_KEY,
  ExecutionAiToolRequest,
  Workflow,
} from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';

type InvokeTool = (
  args: JsonObject,
  request: (options: IHttpRequestOptions) => Promise<unknown>,
) => Promise<string>;

function loadable(
  type: string,
  ports: { inputs: string[]; outputs: string[] },
  impl: Partial<INodeType>,
): ILoadableNodeType {
  const description = {
    displayName: type,
    name: type,
    group: ['transform'],
    version: 1,
    description: '',
    defaults: { name: type },
    inputs: ports.inputs,
    outputs: ports.outputs,
    properties: [],
  };
  return {
    type,
    description,
    load: async () =>
      class implements INodeType {
        description = description;
        execute = impl.execute;
        supplyData = impl.supplyData;
      },
  };
}

function manifest(invoke: InvokeTool): ILoadableNodeType[] {
  return [
    loadable('t.start', { inputs: ['main'], outputs: ['main'] }, {
      async execute(this: IExecuteContext) {
        return [this.getInputData()];
      },
    }),
    loadable('t.agentHost', { inputs: ['main', 'ai_tool'], outputs: ['main'] }, {
      async execute(this: IExecuteContext) {
        const context = this.getContext();
        const results = context[AI_TOOL_RESULTS_CONTEXT_KEY] as JsonObject | undefined;
        const result = results?.['call-1'];
        if (typeof result === 'string') {
          delete results!['call-1'];
          return [[{ json: { result } }]];
        }
        context['requested'] = true;
        throw new ExecutionAiToolRequest({
          parentNodeName: this.getNode().name,
          sourceNodeName: 'Tool',
          toolName: 'lookup',
          toolCallId: 'call-1',
          args: { id: 42 },
          itemIndex: 0,
        });
      },
    }),
    loadable('t.tool', { inputs: [], outputs: ['ai_tool'] }, {
      async supplyData(this: ISupplyDataContext) {
        const request = this.helpers.httpRequest.bind(this.helpers);
        const tool: IAiTool = {
          spec: { name: 'lookup', description: 'lookup' },
          invoke: (args) => invoke(args, request),
        };
        return tool;
      },
    }),
  ];
}

function node(
  name: string,
  type: string,
  parameters: JsonObject = {},
  settings: Partial<INode> = {},
): INode {
  return {
    id: name,
    name,
    type,
    typeVersion: 1,
    position: [0, 0],
    parameters,
    ...settings,
  };
}

function workflow(tool: INode): Workflow {
  return new Workflow({
    name: 'Agent V3',
    nodes: [node('Start', 't.start'), node('Agent', 't.agentHost'), tool],
    connections: {
      Start: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
      Tool: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] },
    },
  });
}

describe('Agent V3 — 工具调用由 WorkflowExecute 调度', () => {
  it('真实工具节点继承 retry，并按每次调用写 runData/metadata/hooks', async () => {
    let attempts = 0;
    const invoke = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary');
      return 'found-42';
    });
    const hooks: string[] = [];
    const engine = new WorkflowExecute(new NodeLoader(manifest(invoke)), {
      hooks: {
        nodeExecuteBefore: (name) => hooks.push(`before:${name}`),
        nodeExecuteAfter: (name) => hooks.push(`after:${name}`),
      },
    });
    const run = await engine.run(
      workflow(node('Tool', 't.tool', {}, { retryOnFail: true, maxTries: 2 })),
    );

    expect(run.status).toBe('success');
    expect(attempts).toBe(2);
    expect(run.data.resultData.runData['Tool']).toHaveLength(1);
    expect(run.data.resultData.runData['Tool']![0]).toMatchObject({
      tryCount: 2,
      data: { ai_tool: [[{ json: { result: 'found-42' } }]] },
      metadata: {
        agentToolCall: {
          callId: 'call-1',
          toolName: 'lookup',
          parentNodeName: 'Agent',
          itemIndex: 0,
        },
      },
    });
    expect(run.data.resultData.runData['Agent']![0]!.data?.['main']?.[0]?.[0]?.json).toEqual({
      result: 'found-42',
    });
    expect(hooks).toContain('before:Tool');
    expect(hooks).toContain('after:Tool');
  });

  it('requireApproval 首次挂起；拒绝后不执行工具并从 Agent 帧恢复', async () => {
    const invoke = vi.fn(async () => 'must-not-run');
    const loader = new NodeLoader(manifest(invoke));
    const wf = workflow(node('Tool', 't.tool', { requireApproval: true }));
    const first = await new WorkflowExecute(loader).run(wf);

    expect(first.status).toBe('waiting');
    expect(first.data.resultData.lastNodeExecuted).toBe('Tool');
    expect(() => JSON.stringify(first.data)).not.toThrow();
    const frames = first.data.executionData!.nodeExecutionStack;
    expect(frames.map((frame) => frame.node.name)).toEqual(['Agent', 'Tool']);
    expect(frames.at(-1)?.aiToolAction?.toolCallId).toBe('call-1');

    first.data.contextData ??= {};
    first.data.contextData['Tool'] = {
      resumeData: [{ json: { decision: 'reject' } }] as unknown as JsonObject,
    };
    const resumed = await new WorkflowExecute(loader).processRunExecutionData(wf, first.data);
    expect(resumed.status).toBe('success');
    expect(invoke).not.toHaveBeenCalled();
    expect(resumed.data.resultData.runData['Agent']![0]!.data?.['main']?.[0]?.[0]?.json).toEqual({
      result: 'Tool call rejected by human',
    });
  });

  it('取消会 abort 工具的在飞 HTTP，并以 canceled 收束', async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const invoke: InvokeTool = async (_args, request) => {
      await request({ url: 'https://tool.test/slow' });
      return 'late';
    };
    const httpRequest = (options: IHttpRequestOptions) =>
      new Promise<unknown>((_resolve, reject) => {
        started();
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      });
    const engine = new WorkflowExecute(new NodeLoader(manifest(invoke)), {
      additionalData: { httpRequest },
    });
    const pending = engine.run(workflow(node('Tool', 't.tool')));
    await hasStarted;
    engine.cancel();
    const run = await pending;

    expect(run.status).toBe('canceled');
    expect(run.data.resultData.runData['Tool']?.[0]?.error?.message).toBe('Execution canceled');
    expect(run.data.resultData.runData['Agent']).toBeUndefined();
  });
});
