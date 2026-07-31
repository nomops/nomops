import { marked } from 'marked';
import TurndownService from 'turndown';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, setPath } from '../../lib/data-transform.js';
import { getPath } from '../../lib/object-path.js';
import { markdownDescription } from './Markdown.description.js';

export class Markdown implements INodeType {
  description = markdownDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output = await Promise.all(this.getInputData().map(async (item, itemIndex) => {
      const mode = String(this.getNodeParameter('mode', itemIndex, 'markdownToHtml'));
      const sourceField = String(this.getNodeParameter('sourceField', itemIndex, 'data'));
      const source = getPath(item.json, sourceField);
      if (typeof source !== 'string') throw new OperationalError(`Markdown: source field "${sourceField}" must contain text`, {});
      let result: string;
      if (mode === 'markdownToHtml') {
        result = await marked.parse(source, {
          gfm: this.getNodeParameter('gfm', itemIndex, true) === true,
          breaks: this.getNodeParameter('breaks', itemIndex, false) === true,
        });
      } else if (mode === 'htmlToMarkdown') {
        result = new TurndownService({
          bulletListMarker: String(this.getNodeParameter('bulletMarker', itemIndex, '-')) as '-' | '+' | '*',
          codeBlockStyle: 'fenced',
          headingStyle: 'atx',
        }).turndown(source);
      } else {
        throw new OperationalError(`Markdown: unsupported mode "${mode}"`, {});
      }
      const json = cloneJsonObject(item.json);
      setPath(json, String(this.getNodeParameter('outputField', itemIndex, 'data')), result);
      return { ...item, json, pairedItem: { item: itemIndex } };
    }));
    return [output];
  }
}
