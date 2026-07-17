import { describe, expect, it } from 'vitest';
import type {
  IAiLanguageModel,
  IAiTool,
  IExecuteContext,
  ILoadableNodeType,
  INodeExecutionData,
  INodeType,
  ISupplyDataContext,
} from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from './workflow-execute.js';

/* ────────────── 内联测试节点：能力子节点 + 宿主 ────────────── */

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

const testNodes: ILoadableNodeType[] = [
  // 起点：透传
  loadable('t.start', { inputs: ['main'], outputs: ['main'] }, {
    async execute(this: IExecuteContext) {
      return [this.getInputData()];
    },
  }),
  // 假模型：回显参数里的 flavor + 收到的工具名单
  loadable('t.model', { inputs: [], outputs: ['ai_languageModel'] }, {
    async supplyData(this: ISupplyDataContext) {
      const flavor = String(this.getNodeParameter('flavor', 'plain'));
      const model: IAiLanguageModel = {
        chat: async (messages, options) => ({
          content: `[${flavor}] saw ${messages.length} messages, tools=${(options?.tools ?? []).map((t) => t.name).join(',')}`,
        }),
      };
      return model;
    },
  }),
  // 假工具：echo
  loadable('t.tool', { inputs: [], outputs: ['ai_tool'] }, {
    async supplyData(this: ISupplyDataContext) {
      const name = String(this.getNodeParameter('toolName', 'echo'));
      const tool: IAiTool = {
        spec: { name, description: 'echo back' },
        invoke: async (args) => `echo:${JSON.stringify(args)}`,
      };
      return tool;
    },
  }),
  // 无 supplyData 的普通节点（用于错误分支）
  loadable('t.plain', { inputs: ['main'], outputs: ['main'] }, {
    async execute(this: IExecuteContext) {
      return [this.getInputData()];
    },
  }),
  // 嵌套：工具自己挂一个模型（RAG 式组合）
  loadable('t.nestedTool', { inputs: ['ai_languageModel'], outputs: ['ai_tool'] }, {
    async supplyData(this: ISupplyDataContext) {
      const models = (await this.getInputConnectionData('ai_languageModel')) as IAiLanguageModel[];
      const inner = models[0]!;
      const tool: IAiTool = {
        spec: { name: 'ask-inner', description: 'ask nested model' },
        invoke: async () => (await inner.chat([{ role: 'user', content: 'hi' }])).content,
      };
      return tool;
    },
  }),
  // 宿主：解析模型+工具，调一次模型、调一次每个工具
  loadable('t.host', { inputs: ['main', 'ai_languageModel', 'ai_tool'], outputs: ['main'] }, {
    async execute(this: IExecuteContext) {
      const models = (await this.getInputConnectionData('ai_languageModel')) as IAiLanguageModel[];
      const tools = (await this.getInputConnectionData('ai_tool')) as IAiTool[];
      const reply = await models[0]!.chat([{ role: 'user', content: 'q' }], {
        tools: tools.map((t) => t.spec),
      });
      const toolResults: string[] = [];
      for (const t of tools) toolResults.push(await t.invoke({ q: 1 }));
      return [[{ json: { reply: reply.content, toolResults } }]];
    },
  }),
];

const node = (name: string, type: string, parameters: Record<string, unknown> = {}) => ({
  id: name, name, type, typeVersion: 1, position: [0, 0] as [number, number], parameters,
});
const to = (n: string, type = 'main', index = 0) => ({ node: n, type, index });
const engine = () => new WorkflowExecute(new NodeLoader(testNodes));

function hostOut(run: { data: { resultData: { runData: Record<string, Array<{ data?: { main?: Array<INodeExecutionData[] | null> } }>> } } }) {
  return run.data.resultData.runData['Host']![0]!.data!['main']![0]![0]!.json;
}

describe('AI 组合 — 连接类型 + supplyData', () => {
  it('宿主解析模型/工具能力；子节点不进数据流、不被当起点', async () => {
    const wf = new Workflow({
      name: 'agent-ish',
      nodes: [
        node('Model', 't.model', { flavor: 'fast' }),
        node('Echo', 't.tool', { toolName: 'echo' }),
        node('Start', 't.start'),
        node('Host', 't.host'),
      ],
      connections: {
        Start: { main: [[to('Host')]] },
        Model: { ai_languageModel: [[to('Host', 'ai_languageModel')]] },
        Echo: { ai_tool: [[to('Host', 'ai_tool')]] },
      },
    });

    expect(wf.getStartNode()?.name).toBe('Start'); // 子节点排除在起点候选外
    expect(wf.isSubNode('Model')).toBe(true);
    expect(wf.isSubNode('Start')).toBe(false);

    const run = await engine().run(wf, undefined, undefined, [{ json: {} }]);
    expect(run.status).toBe('success');
    expect(hostOut(run)).toEqual({
      reply: '[fast] saw 1 messages, tools=echo',
      toolResults: ['echo:{"q":1}'],
    });
    // 子节点不产生 runData（不是数据流执行）
    expect(run.data.resultData.runData['Model']).toBeUndefined();
    expect(run.data.resultData.runData['Echo']).toBeUndefined();
  });

  it('嵌套组合：工具自己挂模型（supply 上下文递归）', async () => {
    const wf = new Workflow({
      name: 'nested',
      nodes: [
        node('Inner', 't.model', { flavor: 'deep' }),
        node('Nested', 't.nestedTool'),
        node('Top', 't.model', { flavor: 'top' }),
        node('Start', 't.start'),
        node('Host', 't.host'),
      ],
      connections: {
        Start: { main: [[to('Host')]] },
        Top: { ai_languageModel: [[to('Host', 'ai_languageModel')]] },
        Inner: { ai_languageModel: [[to('Nested', 'ai_languageModel')]] },
        Nested: { ai_tool: [[to('Host', 'ai_tool')]] },
      },
    });

    const run = await engine().run(wf, undefined, undefined, [{ json: {} }]);
    expect(run.status).toBe('success');
    const out = hostOut(run) as { toolResults: string[] };
    expect(out.toolResults[0]).toBe('[deep] saw 1 messages, tools=');
  });

  it('挂了不提供 supplyData 的节点 → 报错指明', async () => {
    const wf = new Workflow({
      name: 'bad',
      nodes: [node('P', 't.plain'), node('Start', 't.start'), node('Host', 't.host')],
      connections: {
        Start: { main: [[to('Host')]] },
        P: { ai_tool: [[to('Host', 'ai_tool')]] },
      },
    });
    const run = await engine().run(wf, undefined, undefined, [{ json: {} }]);
    expect(run.status).toBe('error');
    expect(run.data.resultData.error?.message).toContain('不提供 supplyData');
  });
});
