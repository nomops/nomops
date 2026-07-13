import type { IConnections, INode } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

/**
 * 内置工作流模板注册表（docs/10 Step B1）。
 * 每个模板都是用 nomops 真实节点组成、导入即可运行的 workflow JSON；
 * 与营销站 /templates 展示的清单一一对应。
 */
export interface ITemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  /** 用到的节点显示名（画廊标签用）。 */
  nodeTags: string[];
  nodes: INode[];
  connections: IConnections;
  /** 导入后需要用户补配置的提示（如凭证/URL）。 */
  setupHints?: string[];
}

const to = (node: string, index = 0) => ({ node, type: 'main', index });

export const BUILTIN_TEMPLATES: ITemplate[] = [
  {
    id: 'welcome-order',
    name: 'New order notification',
    description: 'Webhook receives an order → branch by amount → call the inventory API for large orders, tag low-value ones.',
    category: 'Sales',
    nodeTags: ['Webhook', 'IF', 'HTTP Request', 'Set'],
    setupHints: ['Point the HTTP Request URL at your inventory API', 'Once active, POST /webhook/new-order to trigger'],
    nodes: [
      { id: 'a', name: 'Order Webhook', type: 'nomops.webhook', typeVersion: 1, position: [40, 200], parameters: { path: 'new-order', method: 'POST' } },
      { id: 'b', name: 'Big Order?', type: 'nomops.if', typeVersion: 1, position: [280, 200], parameters: { conditions: [{ left: '={{ $json.body.amount }}', op: 'gt', right: 100 }] } },
      { id: 'c', name: 'Notify Inventory', type: 'nomops.httpRequest', typeVersion: 1, position: [520, 120], parameters: { url: 'https://example.com/api/inventory', method: 'POST' } },
      { id: 'd', name: 'Tag Low Value', type: 'nomops.set', typeVersion: 1, position: [520, 300], parameters: { fields: { lowValue: true } } },
    ],
    connections: {
      'Order Webhook': { main: [[to('Big Order?')]] },
      'Big Order?': { main: [[to('Notify Inventory')], [to('Tag Low Value')]] },
    },
  },
  {
    id: 'daily-report',
    name: 'Daily metrics report',
    description: 'Cron fires at 9am daily → fetch a metrics API → Code rolls up the report fields.',
    category: 'IT Ops',
    nodeTags: ['Schedule', 'HTTP Request', 'Code'],
    setupHints: ['Point the HTTP Request URL at your metrics API', 'Once active, runs automatically on the cron schedule'],
    nodes: [
      { id: 'a', name: 'Every Morning', type: 'nomops.schedule', typeVersion: 1, position: [40, 200], parameters: { mode: 'cron', cronExpression: '0 9 * * *' } },
      { id: 'b', name: 'Fetch Metrics', type: 'nomops.httpRequest', typeVersion: 1, position: [280, 200], parameters: { url: 'https://example.com/api/metrics', method: 'GET' } },
      { id: 'c', name: 'Summarize', type: 'nomops.code', typeVersion: 1, position: [520, 200], parameters: { code: 'return items.map(it => ({ json: { report: "daily", source: it.json } }));' } },
    ],
    connections: {
      'Every Morning': { main: [[to('Fetch Metrics')]] },
      'Fetch Metrics': { main: [[to('Summarize')]] },
    },
  },
  {
    id: 'ai-summary',
    name: 'AI content summary',
    description: 'Receive text → AI Agent (Claude) writes a one-sentence summary → merge it back into the data.',
    category: 'AI',
    nodeTags: ['Webhook', 'AI Agent', 'Set'],
    setupHints: ['Configure an Anthropic API credential on the AI Agent node', 'Once active, POST /webhook/summarize to trigger'],
    nodes: [
      { id: 'a', name: 'Text In', type: 'nomops.webhook', typeVersion: 1, position: [40, 200], parameters: { path: 'summarize', method: 'POST' } },
      { id: 'b', name: 'Summarize', type: 'nomops.aiAgent', typeVersion: 1, position: [280, 200], parameters: { prompt: '={{ "Summarize in one sentence: " + ($json.body.text ?? "") }}', maxTokens: 200 } },
      { id: 'c', name: 'Merge Result', type: 'nomops.set', typeVersion: 1, position: [520, 200], parameters: { fields: { summarized: true } } },
    ],
    connections: {
      'Text In': { main: [[to('Summarize')]] },
      Summarize: { main: [[to('Merge Result')]] },
    },
  },
  {
    id: 'branch-merge-demo',
    name: 'Branch & merge starter',
    description: 'Generate two test items → IF branches by amount → tag each path → Merge them back together. Runs manually right after import.',
    category: 'Advanced',
    nodeTags: ['Manual Trigger', 'Code', 'IF', 'Set', 'Merge'],
    nodes: [
      { id: 'a', name: 'Start', type: 'nomops.manualTrigger', typeVersion: 1, position: [40, 200], parameters: {} },
      { id: 'b', name: 'Seed Data', type: 'nomops.code', typeVersion: 1, position: [250, 200], parameters: { code: 'return [{ json: { amount: 150 } }, { json: { amount: 50 } }];' } },
      { id: 'c', name: 'Big?', type: 'nomops.if', typeVersion: 1, position: [460, 200], parameters: { conditions: [{ left: '={{ $json.amount }}', op: 'gt', right: 100 }] } },
      { id: 'd', name: 'Tag Big', type: 'nomops.set', typeVersion: 1, position: [670, 120], parameters: { fields: { size: 'big' } } },
      { id: 'e', name: 'Tag Small', type: 'nomops.set', typeVersion: 1, position: [670, 300], parameters: { fields: { size: 'small' } } },
      { id: 'f', name: 'Merge', type: 'nomops.merge', typeVersion: 1, position: [880, 200], parameters: {} },
    ],
    connections: {
      Start: { main: [[to('Seed Data')]] },
      'Seed Data': { main: [[to('Big?')]] },
      'Big?': { main: [[to('Tag Big')], [to('Tag Small')]] },
      'Tag Big': { main: [[to('Merge', 0)]] },
      'Tag Small': { main: [[to('Merge', 1)]] },
    },
  },
];

/** 画廊摘要（不含节点 JSON，前端列表用）。 */
export function templateSummaries() {
  return BUILTIN_TEMPLATES.map(({ id, name, description, category, nodeTags, setupHints }) => ({
    id,
    name,
    description,
    category,
    nodeTags,
    setupHints: setupHints ?? [],
  }));
}

export function getTemplate(id: string): ITemplate {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new OperationalError('Template not found', { status: 404, templateId: id });
  return template;
}
