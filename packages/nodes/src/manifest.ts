import type { ILoadableNodeType } from '@nomops/workflow';
import { setDescription } from './nodes/Set/Set.description.js';
import { noOpDescription } from './nodes/NoOp/NoOp.description.js';
import { manualTriggerDescription } from './nodes/ManualTrigger/ManualTrigger.description.js';
import { ifDescription } from './nodes/If/If.description.js';
import { mergeDescription } from './nodes/Merge/Merge.description.js';
import { codeDescription } from './nodes/Code/Code.description.js';
import { httpRequestDescription } from './nodes/HttpRequest/HttpRequest.description.js';
import { webhookDescription } from './nodes/Webhook/Webhook.description.js';
import { scheduleDescription } from './nodes/Schedule/Schedule.description.js';
import { executeWorkflowDescription } from './nodes/ExecuteWorkflow/ExecuteWorkflow.description.js';
import { aiAgentDescription } from './nodes/AiAgent/AiAgent.description.js';
import { waitDescription } from './nodes/Wait/Wait.description.js';
import { pollingTriggerDescription } from './nodes/PollingTrigger/PollingTrigger.description.js';
import { chatTriggerDescription } from './nodes/ChatTrigger/ChatTrigger.description.js';
import { anthropicChatModelDescription } from './nodes/AnthropicChatModel/AnthropicChatModel.node.js';
import { httpToolDescription } from './nodes/HttpTool/HttpTool.node.js';
import { windowMemoryDescription } from './nodes/WindowMemory/WindowMemory.node.js';
import { stickyNoteDescription } from './nodes/StickyNote/StickyNote.node.js';
import { declarative } from './nodes/integrations/declarative.js';
import { integrationDescriptions } from './nodes/integrations/integrations.js';

/**
 * 内置节点清单：description 静态常驻（轻量），节点类经 `load()` 懒加载（重量级 execute 代码）。
 * 这是节点加载器的数据源；社区包将来提供各自的清单。
 */
export const builtinNodeManifest: ILoadableNodeType[] = [
  {
    type: `nomops.${setDescription.name}`,
    description: setDescription,
    load: () => import('./nodes/Set/Set.node.js').then((m) => m.Set),
  },
  {
    type: `nomops.${noOpDescription.name}`,
    description: noOpDescription,
    load: () => import('./nodes/NoOp/NoOp.node.js').then((m) => m.NoOp),
  },
  {
    type: `nomops.${manualTriggerDescription.name}`,
    description: manualTriggerDescription,
    load: () => import('./nodes/ManualTrigger/ManualTrigger.node.js').then((m) => m.ManualTrigger),
  },
  {
    type: `nomops.${chatTriggerDescription.name}`,
    description: chatTriggerDescription,
    load: () => import('./nodes/ChatTrigger/ChatTrigger.node.js').then((m) => m.ChatTrigger),
  },
  {
    type: `nomops.${ifDescription.name}`,
    description: ifDescription,
    load: () => import('./nodes/If/If.node.js').then((m) => m.If),
  },
  {
    type: `nomops.${mergeDescription.name}`,
    description: mergeDescription,
    load: () => import('./nodes/Merge/Merge.node.js').then((m) => m.Merge),
  },
  {
    type: `nomops.${codeDescription.name}`,
    description: codeDescription,
    load: () => import('./nodes/Code/Code.node.js').then((m) => m.Code),
  },
  {
    type: `nomops.${httpRequestDescription.name}`,
    description: httpRequestDescription,
    load: () => import('./nodes/HttpRequest/HttpRequest.node.js').then((m) => m.HttpRequest),
  },
  {
    type: `nomops.${webhookDescription.name}`,
    description: webhookDescription,
    load: () => import('./nodes/Webhook/Webhook.node.js').then((m) => m.Webhook),
  },
  {
    type: `nomops.${scheduleDescription.name}`,
    description: scheduleDescription,
    load: () => import('./nodes/Schedule/Schedule.node.js').then((m) => m.Schedule),
  },
  {
    type: `nomops.${executeWorkflowDescription.name}`,
    description: executeWorkflowDescription,
    load: () => import('./nodes/ExecuteWorkflow/ExecuteWorkflow.node.js').then((m) => m.ExecuteWorkflow),
  },
  {
    type: `nomops.${aiAgentDescription.name}`,
    description: aiAgentDescription,
    load: () => import('./nodes/AiAgent/AiAgent.node.js').then((m) => m.AiAgent),
  },
  {
    type: `nomops.${waitDescription.name}`,
    description: waitDescription,
    load: () => import('./nodes/Wait/Wait.node.js').then((m) => m.Wait),
  },
  {
    type: `nomops.${pollingTriggerDescription.name}`,
    description: pollingTriggerDescription,
    load: () => import('./nodes/PollingTrigger/PollingTrigger.node.js').then((m) => m.PollingTrigger),
  },
  {
    type: `nomops.${anthropicChatModelDescription.name}`,
    description: anthropicChatModelDescription,
    load: () => import('./nodes/AnthropicChatModel/AnthropicChatModel.node.js').then((m) => m.AnthropicChatModel),
  },
  {
    type: `nomops.${httpToolDescription.name}`,
    description: httpToolDescription,
    load: () => import('./nodes/HttpTool/HttpTool.node.js').then((m) => m.HttpTool),
  },
  {
    type: `nomops.${windowMemoryDescription.name}`,
    description: windowMemoryDescription,
    load: () => import('./nodes/WindowMemory/WindowMemory.node.js').then((m) => m.WindowMemory),
  },
  {
    type: `nomops.${stickyNoteDescription.name}`,
    description: stickyNoteDescription,
    load: () => import('./nodes/StickyNote/StickyNote.node.js').then((m) => m.StickyNote),
  },
  // 声明式集成节点：纯描述驱动（无 execute），引擎 routing 执行器负责发请求
  ...integrationDescriptions.map(declarative),
];
