import type { IExecuteContext, INodeExecutionData, INodeType, IWebhookContext, IWebhookResult } from '@nomops/workflow';
import { formDefinitionFrom, handleFormRequest } from '../Form/form-utils.js';
import { formTriggerDescription } from './FormTrigger.description.js';

export class FormTrigger implements INodeType {
  description = formTriggerDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    return [[{ json: {} }]];
  }

  async webhook(this: IWebhookContext): Promise<IWebhookResult> {
    const definition = formDefinitionFrom(this.getNodeParameter('fields'), {
      title: this.getNodeParameter('formTitle', 'Form'),
      description: this.getNodeParameter('formDescription', ''),
      submitLabel: this.getNodeParameter('submitLabel', 'Submit'),
    });
    return handleFormRequest(this.getRequest(), definition);
  }
}
