import { load } from 'cheerio';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, setPath } from '../../lib/data-transform.js';
import { getPath } from '../../lib/object-path.js';
import { htmlDescription } from './Html.description.js';

interface IExtractionValue {
  outputField?: unknown;
  cssSelector?: unknown;
  returnValue?: unknown;
  attribute?: unknown;
  returnArray?: unknown;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textToHtml(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>\n')}</p>`)
    .join('\n');
}

function extractValues(source: string, values: IExtractionValue[], shouldCleanText: boolean): Array<[string, string | string[]]> {
  const $ = load(source);
  return values.map((entry) => {
    const outputField = String(entry.outputField ?? '').trim();
    const selector = String(entry.cssSelector ?? '').trim();
    if (!outputField || !selector) throw new OperationalError('HTML: each extraction needs an output field and CSS selector', {});
    const returnValue = String(entry.returnValue ?? 'text');
    const attribute = String(entry.attribute ?? '');
    const extracted = $(selector).toArray().map((element) => {
      const selected = $(element);
      if (returnValue === 'html') return selected.html() ?? '';
      if (returnValue === 'attribute') {
        if (!attribute) throw new OperationalError('HTML: attribute name must not be empty', {});
        return selected.attr(attribute) ?? '';
      }
      const text = selected.text();
      return shouldCleanText ? cleanText(text) : text.trim();
    });
    return [outputField, entry.returnArray === true ? extracted : extracted.join('')];
  });
}

export class Html implements INodeType {
  description = htmlDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const output = this.getInputData().map((item, itemIndex) => {
      const operation = String(this.getNodeParameter('operation', itemIndex, 'extract'));
      const sourceField = String(this.getNodeParameter('sourceField', itemIndex, 'data'));
      const source = getPath(item.json, sourceField);
      if (typeof source !== 'string') throw new OperationalError(`HTML: source field "${sourceField}" must contain text`, {});
      const json = cloneJsonObject(item.json);
      if (operation === 'textToHtml') {
        setPath(json, String(this.getNodeParameter('outputField', itemIndex, 'html')), textToHtml(source));
      } else if (operation === 'extract') {
        const configured = this.getNodeParameter('extractionValues', itemIndex, { values: [] }) as { values?: IExtractionValue[] };
        for (const [path, value] of extractValues(source, configured.values ?? [], this.getNodeParameter('cleanUpText', itemIndex, true) === true)) {
          setPath(json, path, value);
        }
      } else {
        throw new OperationalError(`HTML: unsupported operation "${operation}"`, {});
      }
      return { ...item, json, pairedItem: { item: itemIndex } };
    });
    return [output];
  }
}
