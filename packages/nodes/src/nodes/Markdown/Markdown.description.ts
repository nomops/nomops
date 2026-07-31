import type { INodeTypeDescription } from '@nomops/workflow';

export const markdownDescription: INodeTypeDescription = {
  displayName: 'Markdown',
  name: 'markdown',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['markdown to html', 'html to markdown', 'md'],
  version: 1,
  description: 'Convert data between Markdown and HTML',
  defaults: { name: 'Markdown' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Mode',
      name: 'mode',
      type: 'options',
      default: 'markdownToHtml',
      noDataExpression: true,
      options: [
        { name: 'Markdown to HTML', value: 'markdownToHtml' },
        { name: 'HTML to Markdown', value: 'htmlToMarkdown' },
      ],
    },
    {
      displayName: 'Source Field',
      name: 'sourceField',
      type: 'string',
      default: 'data',
      required: true,
      description: 'Field containing the Markdown or HTML source',
    },
    {
      displayName: 'GitHub Flavored Markdown',
      name: 'gfm',
      type: 'boolean',
      default: true,
      displayOptions: { show: { mode: ['markdownToHtml'] } },
    },
    {
      displayName: 'Convert Line Breaks',
      name: 'breaks',
      type: 'boolean',
      default: false,
      displayOptions: { show: { mode: ['markdownToHtml'] } },
    },
    {
      displayName: 'Bullet Marker',
      name: 'bulletMarker',
      type: 'options',
      default: '-',
      displayOptions: { show: { mode: ['htmlToMarkdown'] } },
      options: [
        { name: '-', value: '-' },
        { name: '*', value: '*' },
        { name: '+', value: '+' },
      ],
    },
    {
      displayName: 'Output Field',
      name: 'outputField',
      type: 'string',
      default: 'data',
      required: true,
      description: 'Field that receives converted content',
    },
  ],
};
