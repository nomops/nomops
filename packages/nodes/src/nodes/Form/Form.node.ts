import type {
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  IWebhookContext,
  IWebhookResult,
} from '@nomops/workflow';
import { ExecutionPause, OperationalError } from '@nomops/workflow';
import { escapeHtml, formDefinitionFrom, handleFormRequest, type IFormDefinition } from './form-utils.js';
import { formDescription } from './Form.description.js';

export class Form implements INodeType {
  description = formDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const operation = String(this.getNodeParameter('operation', 0, 'nextPage'));
    const items = this.getInputData();
    if (operation === 'completion') {
      const respondWith = String(this.getNodeParameter('respondWith', 0, 'text'));
      if (respondWith === 'redirect') {
        const location = String(this.getNodeParameter('redirectUrl', 0, ''));
        this.helpers.setWebhookResponse?.({ statusCode: 302, headers: { Location: location }, body: null });
      } else if (respondWith === 'responseText') {
        this.helpers.setWebhookResponse?.({ contentType: 'text/html; charset=utf-8', body: String(this.getNodeParameter('responseText', 0, '')) });
      } else if (respondWith === 'binary') {
        const field = String(this.getNodeParameter('inputDataFieldName', 0, 'data'));
        const binary = items[0]?.binary?.[field];
        if (!binary) throw new OperationalError(`Form Ending: binary field "${field}" is missing`);
        const body = await this.helpers.binaryToBuffer(binary);
        this.helpers.setWebhookResponse?.({ contentType: binary.mimeType, body });
      } else {
        const title = String(this.getNodeParameter('completionTitle', 0, 'Submitted'));
        const message = String(this.getNodeParameter('completionMessage', 0, 'Your response has been received.'));
        this.helpers.setWebhookResponse?.({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`,
        });
      }
      return [items];
    }
    const context = this.getContext();
    if (this.isResumed()) {
      const data = context['resumeData'];
      delete context['resumeData'];
      delete context['formDefinition'];
      if (!Array.isArray(data)) throw new OperationalError('Form resumed without submitted data');
      return [data as unknown as INodeExecutionData[]];
    }
    const options = this.getNodeParameter('options', 0, {}) as Record<string, unknown>;
    let rawFields = this.getNodeParameter('formFields', 0, this.getNodeParameter('fields', 0, { values: [] }));
    if (String(this.getNodeParameter('defineForm', 0, 'fields')) === 'json') {
      const rawJson = String(this.getNodeParameter('jsonOutput', 0, '[]'));
      try { rawFields = { values: JSON.parse(rawJson) as unknown[] }; }
      catch { throw new OperationalError('Form: Form Elements JSON is invalid'); }
    }
    const definition = formDefinitionFrom(rawFields, {
      title: options['formTitle'] ?? this.getNodeParameter('formTitle', 0, 'Form'),
      description: options['formDescription'] ?? this.getNodeParameter('formDescription', 0, ''),
      submitLabel: options['buttonLabel'] ?? this.getNodeParameter('submitLabel', 0, 'Continue'),
    });
    context['formDefinition'] = definition;
    const limited = this.getNodeParameter('limitWaitTime', 0, false) === true;
    const waitTill = limited ? Date.now() + Math.max(0, Number(this.getNodeParameter('maxWaitTime', 0, 1))) * 3_600_000 : undefined;
    throw new ExecutionPause(waitTill ? { waitTill } : undefined);
  }

  async webhook(this: IWebhookContext): Promise<IWebhookResult> {
    const stored = this.getContext()['formDefinition'];
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      throw new OperationalError('Waiting form definition is unavailable', { status: 409 });
    }
    return handleFormRequest(this.getRequest(), stored as unknown as IFormDefinition);
  }
}
