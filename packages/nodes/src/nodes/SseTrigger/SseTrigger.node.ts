import type { IExecuteContext, INodeExecutionData, INodeType, ITriggerContext, ITriggerResponse, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { sseTriggerDescription } from './SseTrigger.description.js';

function headersOf(value: unknown): Record<string, string> {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      throw new OperationalError('SSE Headers must be valid JSON');
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source as Record<string, unknown>).map(([name, entry]) => [name, String(entry)]));
}

function eventJson(data: string): JsonObject {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
    return { data: parsed as never };
  } catch {
    return { data };
  }
}

export class SseTrigger implements INodeType {
  description = sseTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: {} }]];
  }

  async trigger(this: ITriggerContext): Promise<ITriggerResponse> {
    const url = String(this.getNodeParameter('url'));
    const eventName = String(this.getNodeParameter('eventName') ?? '');
    const headers = headersOf(this.getNodeParameter('headers'));
    const close = await this.helpers.openEventStream({ url, headers }, (message) => {
      if (eventName && message.event !== eventName) return;
      const json = eventJson(message.data);
      if (message.event) json['_event'] = message.event;
      if (message.id) json['_eventId'] = message.id;
      this.emit([[{ json }]]);
    });
    return { closeFunction: close };
  }
}
