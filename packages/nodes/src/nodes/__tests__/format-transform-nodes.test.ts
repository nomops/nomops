import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { Crypto } from '../Crypto/Crypto.node.js';
import { DateTime } from '../DateTime/DateTime.node.js';
import { Html } from '../Html/Html.node.js';
import { Markdown } from '../Markdown/Markdown.node.js';
import { Xml } from '../Xml/Xml.node.js';

function stubContext(
  items: INodeExecutionData[],
  params: Record<string, unknown | ((itemIndex: number) => unknown)> = {},
): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      if (!(name in params)) return fallback;
      const value = params[name];
      return typeof value === 'function' ? (value as (index: number) => unknown)(itemIndex) : value;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    helpers: {} as IExecuteContext['helpers'],
  } as IExecuteContext;
}

describe('Date & Time 节点', () => {
  it('按 IANA 时区解析自定义日期并保持闰日', async () => {
    const output = await new DateTime().execute!.call(stubContext([{ json: {} }], {
      operation: 'parse',
      date: '2024-02-29 23:30:00',
      inputFormat: 'custom',
      customInputFormat: 'yyyy-MM-dd HH:mm:ss',
      timezone: 'Asia/Shanghai',
      outputField: 'result',
    }));
    expect(output[0]![0]!.json['result']).toBe('2024-02-29T23:30:00.000+08:00');
  });

  it('格式化时转换时区，并按日加减跨越夏令时', async () => {
    const formatted = await new DateTime().execute!.call(stubContext([{ json: {} }], {
      operation: 'format',
      date: '2024-01-02T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      outputFormat: 'custom',
      customOutputFormat: 'yyyy-MM-dd HH:mm',
    }));
    expect(formatted[0]![0]!.json['date']).toBe('2024-01-02 08:00');

    const added = await new DateTime().execute!.call(stubContext([{ json: {} }], {
      operation: 'add',
      date: '2024-03-09T12:00:00',
      timezone: 'America/New_York',
      amount: 1,
      unit: 'days',
    }));
    expect(added[0]![0]!.json['date']).toBe('2024-03-10T12:00:00.000-04:00');
  });

  it('拒绝无效时区', async () => {
    await expect(new DateTime().execute!.call(stubContext([{ json: {} }], {
      date: '2024-01-01', timezone: 'Mars/Olympus',
    }))).rejects.toThrow(/invalid timezone/i);
  });
});

describe('Crypto 节点', () => {
  it('对 UTF-8 文本生成 hash 与 HMAC', async () => {
    const value = '你好, nomops';
    const hashed = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'hash', value, algorithm: 'sha256', encoding: 'hex',
    }));
    expect(hashed[0]![0]!.json['data']).toBe(createHash('sha256').update(value).digest('hex'));

    const hmac = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'hmac', value, secret: '密钥', algorithm: 'sha512', encoding: 'base64',
    }));
    expect(hmac[0]![0]!.json['data']).toBe(createHmac('sha512', '密钥').update(value).digest('base64'));
  });

  it('Base64 编解码 Unicode，并生成 UUID', async () => {
    const encoded = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'base64Encode', value: '中文🙂',
    }));
    const decoded = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'base64Decode', value: encoded[0]![0]!.json['data'],
    }));
    expect(decoded[0]![0]!.json['data']).toBe('中文🙂');

    const uuid = await new Crypto().execute!.call(stubContext([{ json: {} }], { action: 'uuid' }));
    expect(uuid[0]![0]!.json['data']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('AES-GCM 加密往返且错误密钥无法解密', async () => {
    const encrypted = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'encrypt', value: '敏感文本🙂', secret: 'correct horse battery staple',
    }));
    const payload = encrypted[0]![0]!.json['data'];
    expect(payload).toMatch(/^v1:/);
    expect(payload).not.toContain('敏感文本');

    const decrypted = await new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'decrypt', value: payload, secret: 'correct horse battery staple',
    }));
    expect(decrypted[0]![0]!.json['data']).toBe('敏感文本🙂');
    await expect(new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'decrypt', value: payload, secret: 'wrong',
    }))).rejects.toThrow(/unable to decrypt/i);
  });

  it('拒绝危险输出路径，不污染对象原型', async () => {
    await expect(new Crypto().execute!.call(stubContext([{ json: {} }], {
      action: 'hash', value: 'x', outputField: '__proto__.polluted',
    }))).rejects.toThrow(/forbidden segment/i);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('HTML 节点', () => {
  it('通过 CSS 选择器提取文本、属性和数组', async () => {
    const html = '<section><a class="item" href="/一"> 第一项 </a><a class="item" href="/二">第二项</a></section>';
    const output = await new Html().execute!.call(stubContext([{ json: { html } }], {
      operation: 'extract',
      sourceField: 'html',
      extractionValues: { values: [
        { outputField: 'first', cssSelector: '.item:first', returnValue: 'text' },
        { outputField: 'links', cssSelector: '.item', returnValue: 'attribute', attribute: 'href', returnArray: true },
      ] },
    }));
    expect(output[0]![0]!.json).toEqual({ html, first: '第一项', links: ['/一', '/二'] });
  });

  it('文本转 HTML 时转义标签并保留段落换行', async () => {
    const output = await new Html().execute!.call(stubContext([{ json: { text: '<标题>\n第二行\n\n新段' } }], {
      operation: 'textToHtml', sourceField: 'text', outputField: 'html',
    }));
    expect(output[0]![0]!.json['html']).toBe('<p>&lt;标题&gt;<br>\n第二行</p>\n<p>新段</p>');
  });
});

describe('XML 节点', () => {
  it('解析属性、重复元素和 Unicode，并可构建 XML', async () => {
    const parsed = await new Xml().execute!.call(stubContext([{ json: { data: '<catalog lang="zh"><item>一</item><item>二🙂</item></catalog>' } }], {
      mode: 'xmlToJson', sourceField: 'data', outputField: 'parsed',
    }));
    expect(parsed[0]![0]!.json['parsed']).toEqual({ catalog: { '@_lang': 'zh', item: ['一', '二🙂'] } });

    const built = await new Xml().execute!.call(stubContext([{ json: { payload: { item: ['一', '二🙂'] } } }], {
      mode: 'jsonToXml', sourceField: 'payload', outputField: 'xml', rootName: 'catalog', format: false,
    }));
    expect(built[0]![0]!.json['xml']).toBe('<catalog><item>一</item><item>二🙂</item></catalog>');
  });

  it('拒绝文档类型与实体声明', async () => {
    await expect(new Xml().execute!.call(stubContext([{ json: { data: '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>' } }]))).rejects.toThrow(/not allowed/i);
  });
});

describe('Markdown 节点', () => {
  it('Markdown 与 HTML 双向转换并保留 Unicode', async () => {
    const html = await new Markdown().execute!.call(stubContext([{ json: { source: '# 标题\n\n- 一\n- 二🙂' } }], {
      mode: 'markdownToHtml', sourceField: 'source', outputField: 'result',
    }));
    expect(html[0]![0]!.json['result']).toContain('<h1>标题</h1>');
    expect(html[0]![0]!.json['result']).toContain('<li>二🙂</li>');

    const markdown = await new Markdown().execute!.call(stubContext([{ json: { source: '<h2>标题</h2><p><strong>粗体</strong>🙂</p>' } }], {
      mode: 'htmlToMarkdown', sourceField: 'source', outputField: 'result',
    }));
    expect(markdown[0]![0]!.json['result']).toBe('## 标题\n\n**粗体**🙂');
    expect(() => JSON.stringify(markdown)).not.toThrow();
  });
});
