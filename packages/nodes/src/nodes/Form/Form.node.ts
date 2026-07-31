import type {
  IExecuteContext,
  INodeExecutionData,
  INodeType,
  IWebhookContext,
  IWebhookResult,
} from '@nomops/workflow';
import { ExecutionPause, OperationalError } from '@nomops/workflow';
import { formDefinitionFrom, handleFormRequest, type IFormDefinition } from './form-utils.js';
import { formDescription } from './Form.description.js';

export class Form implements INodeType {
  description = formDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const context = this.getContext();
    if (this.isResumed()) {
      const data = context['resumeData'];
      delete context['resumeData'];
      delete context['formDefinition'];
      if (!Array.isArray(data)) throw new OperationalError('Form resumed without submitted data');
      return [data as unknown as INodeExecutionData[]];
    }
    const definition = formDefinitionFrom(this.getNodeParameter('fields', 0), {
      title: this.getNodeParameter('formTitle', 0, 'Form'),
      description: this.getNodeParameter('formDescription', 0, ''),
      submitLabel: this.getNodeParameter('submitLabel', 0, 'Continue'),
    });
    context['formDefinition'] = definition;
    throw new ExecutionPause();
  }

  async webhook(this: IWebhookContext): Promise<IWebhookResult> {
    const stored = this.getContext()['formDefinition'];
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      throw new OperationalError('Waiting form definition is unavailable', { status: 409 });
    }
    return handleFormRequest(this.getRequest(), stored as unknown as IFormDefinition);
  }
}
