import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import type { INodeProperties } from '@nomops/workflow';
import { hasTranslation, setLocale, startDomTranslation, t } from '../i18n.js';
import { localizeNodeProperty } from '../i18n-node.js';

afterEach(() => setLocale('en'));

describe('Simplified Chinese localization', () => {
  it('translates product and orchestrator messages and interpolates values', () => {
    setLocale('zh-CN');
    expect(t('Personal Settings')).toBe('个人设置');
    expect(t('What triggers this workflow?')).toBe('什么会触发此工作流？');
    expect(t('Item {n} of {total}', { n: 2, total: 5 })).toBe('第 2 项，共 5 项');
    expect(t('Edit HTTP Request')).toBe('编辑 HTTP Request');
  });

  it('recursively localizes node fields without changing protocol keys or defaults', () => {
    const property: INodeProperties = {
      displayName: 'Query Parameters',
      name: 'queryParameters',
      type: 'fixedCollection',
      default: { parameters: [] },
      typeOptions: {
        multipleValues: true,
        fixedCollection: { itemTitle: 'Query Parameter', addButtonLabel: 'Add Query Parameter' },
      },
      options: [{
        name: 'parameters',
        value: 'parameters',
        values: [{ displayName: 'Field Name', name: 'name', type: 'string', default: '' }],
      }],
    };
    setLocale('zh-CN');
    const localized = localizeNodeProperty(property);
    expect(localized.displayName).toBe('查询参数');
    expect(localized.name).toBe('queryParameters');
    expect(localized.default).toEqual({ parameters: [] });
    expect(localized.typeOptions?.fixedCollection).toMatchObject({
      itemTitle: '查询参数',
      addButtonLabel: '添加查询参数',
    });
    expect(localized.options?.[0]?.values?.[0]).toMatchObject({ displayName: '字段名称', name: 'name' });
  });

  it('localizes legacy static text and accessible attributes in both directions', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<button title="Close node panel">No matching nodes</button><input placeholder="Search nodes...">';
    document.body.append(root);
    const stop = startDomTranslation(root);
    setLocale('zh-CN');
    await nextTick();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(root.textContent).toContain('没有匹配的节点');
    expect(root.querySelector('button')?.title).toBe('关闭节点面板');
    expect(root.querySelector('input')?.placeholder).toBe('搜索节点…');

    setLocale('en');
    await nextTick();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(root.textContent).toContain('No matching nodes');
    expect(root.querySelector('button')?.title).toBe('Close node panel');
    stop();
    root.remove();
  });

  it('ships translations for representative fields from every node configuration layer', () => {
    for (const message of [
      'HTTP Request',
      'Makes an HTTP request and returns the response data',
      'Authentication',
      'Using Fields Below',
      'Query Parameter',
      'Add Query Parameter',
      'Response Format',
      'Autodetect',
      'Generate code',
      'Instructions',
      'System Message',
      'Window Size (Messages)',
    ]) {
      expect(hasTranslation(message), message).toBe(true);
    }
  });
});
