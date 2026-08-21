import { describe, expect, it, vi } from 'vitest';
import type {
  IExecuteContext,
  INodeExecutionData,
  INomopsApiRequestOptions,
  ITriggerContext,
  JsonObject,
} from '@nomops/workflow';
import { Nomops } from '../Nomops/Nomops.node.js';
import { nomopsDescription } from '../Nomops/Nomops.description.js';
import { NomopsTrigger } from '../NomopsTrigger/NomopsTrigger.node.js';

function executeContext(
  parameters: JsonObject,
  request: (options: INomopsApiRequestOptions) => Promise<unknown>,
  input: INodeExecutionData[] = [{ json: {} }],
): IExecuteContext {
  return {
    getInputData: () => input,
    getNodeParameter: (name: string, _index: number, fallback?: unknown) => parameters[name] ?? fallback,
    getCredentials: async () => ({ apiKey: 'nmp_unit-test-secret' }),
    getWorkflowStaticData: () => ({}),
    helpers: { nomopsApiRequest: request, httpRequest: async () => ({}) },
  } as IExecuteContext;
}

describe('Nomops self API node', () => {
  it('does not expose a URL or project selector and requires an explicit API credential', () => {
    expect(nomopsDescription.credentials).toEqual([{ name: 'nomopsApi', required: true }]);
    expect(nomopsDescription.properties.some((property) => /url|projectId/i.test(property.name))).toBe(false);
  });

  it('maps a whitelisted workflow operation and limits list output locally', async () => {
    const request = vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const result = await new Nomops().execute!.call(executeContext(
      { resource: 'workflow', operation: 'list', returnAll: false, limit: 2 },
      request,
    ));
    expect(request).toHaveBeenCalledWith({ operation: 'workflow.list', apiKey: 'nmp_unit-test-secret' });
    expect(result[0]!.map((item) => item.json)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('passes only the selected execution ID and retry option', async () => {
    const request = vi.fn(async () => ({ executionId: 'retry-1', status: 'queued' }));
    await new Nomops().execute!.call(executeContext(
      { resource: 'execution', operation: 'retry', resourceId: 'exec/one', useOriginal: true },
      request,
    ));
    expect(request).toHaveBeenCalledWith({
      operation: 'execution.retry',
      apiKey: 'nmp_unit-test-secret',
      resourceId: 'exec/one',
      useOriginal: true,
    });
  });
});

describe('Nomops lifecycle trigger', () => {
  it('emits only a selected lifecycle event with minimal current-workflow metadata', async () => {
    const emit = vi.fn();
    const context = {
      emit,
      getNodeParameter: () => ['activate'],
      getActivationMode: () => 'activate' as const,
      getWorkflow: () => ({ id: 'wf-1', name: 'Lifecycle' }),
      getWorkflowStaticData: () => ({}),
      helpers: { openEventStream: async () => async () => undefined },
    } satisfies ITriggerContext;
    await new NomopsTrigger().trigger!.call(context);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]![0][0][0].json).toMatchObject({
      event: 'Workflow activated', eventType: 'activate', workflowId: 'wf-1', workflowName: 'Lifecycle',
    });
    expect(emit.mock.calls[0]![0][0][0].json).not.toHaveProperty('projectId');
  });

  it('stays silent for unselected lifecycle events and provides a manual sample', async () => {
    const emit = vi.fn();
    await new NomopsTrigger().trigger!.call({
      emit,
      getNodeParameter: () => ['init'],
      getActivationMode: () => 'update',
      getWorkflow: () => ({ id: 'wf-1', name: 'Lifecycle' }),
      getWorkflowStaticData: () => ({}),
      helpers: { openEventStream: async () => async () => undefined },
    } satisfies ITriggerContext);
    expect(emit).not.toHaveBeenCalled();
    const manual = await new NomopsTrigger().execute!.call({} as IExecuteContext);
    expect(manual[0]![0]!.json).toMatchObject({ event: 'Manual execution', eventType: 'manual' });
  });
});
