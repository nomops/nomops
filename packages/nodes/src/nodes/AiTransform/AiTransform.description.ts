import type { INodeTypeDescription } from '@nomops/workflow';

export const aiTransformDescription: INodeTypeDescription = {
  displayName: 'AI Transform',
  name: 'aiTransform',
  group: ['transform'],
  categories: ['dataTransformation', 'ai'],
  aliases: ['natural language transform', 'generate code', 'AI data mapping'],
  version: 1,
  description: 'Generate a deterministic data transform from plain-language instructions',
  defaults: { name: 'AI Transform' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Instructions',
      name: 'instructions',
      type: 'string',
      default: '',
      required: true,
      noDataExpression: true,
      placeholder: "Example: Combine firstName and lastName into fullName, then sort by email",
      description: 'Only these instructions and an input field/type summary are sent to the configured AI provider. Input values are not sent.',
      typeOptions: {
        rows: 4,
        action: {
          type: 'generateAiTransform',
          label: 'Generate code',
          target: 'generatedCode',
          generatedForTarget: 'generatedForPrompt',
          inputFieldMaxLength: 500,
        },
      },
    },
    {
      displayName: 'Generated JavaScript',
      name: 'generatedCode',
      type: 'string',
      default: '',
      noDataExpression: true,
      description: 'Read-only. Change the instructions and generate again, or copy the code into a Code node to edit it manually.',
      typeOptions: { rows: 14, editor: 'code', readOnly: true },
    },
    {
      displayName: 'Generated code runs in the same isolated, empty-environment subprocess as the Code node. The AI provider receives your instructions plus field names and types, never input values or binary contents. Do not put passwords, API keys, tokens, credentials, or sensitive values in the instructions.',
      name: 'privacyNotice',
      type: 'notice',
      default: '',
      typeOptions: { noticeStyle: 'info' },
    },
  ],
};
