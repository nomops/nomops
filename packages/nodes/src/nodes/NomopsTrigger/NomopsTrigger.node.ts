import type { IExecuteContext, INodeExecutionData, INodeType, ITriggerContext, ITriggerResponse } from '@nomops/workflow';
import { nomopsTriggerDescription } from './NomopsTrigger.description.js';

const eventNames = {
  init: 'Instance started',
  activate: 'Workflow activated',
  update: 'Published workflow updated',
} as const;

export class NomopsTrigger implements INodeType {
  description = nomopsTriggerDescription;

  async trigger(this: ITriggerContext): Promise<ITriggerResponse> {
    const mode = this.getActivationMode();
    const events = this.getNodeParameter('events');
    if (Array.isArray(events) && events.includes(mode)) {
      const workflow = this.getWorkflow();
      this.emit([[{
        json: {
          event: eventNames[mode],
          eventType: mode,
          timestamp: new Date().toISOString(),
          workflowId: workflow.id,
          workflowName: workflow.name,
        },
      }]]);
    }
    return {};
  }

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: { event: 'Manual execution', eventType: 'manual', timestamp: new Date().toISOString() } }]];
  }
}
