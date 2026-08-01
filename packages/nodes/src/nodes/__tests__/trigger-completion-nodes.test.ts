import { describe, expect, it, vi } from 'vitest';
import type {
  IExecuteContext,
  IEventStreamMessage,
  IPollContext,
  ITriggerContext,
  IWebhookContext,
  JsonObject,
} from '@nomops/workflow';
import { FormTrigger } from '../FormTrigger/FormTrigger.node.js';
import { RssFeedRead } from '../RssFeedRead/RssFeedRead.node.js';
import { RssFeedReadTrigger } from '../RssFeedReadTrigger/RssFeedReadTrigger.node.js';
import { SseTrigger } from '../SseTrigger/SseTrigger.node.js';
import { PollingTrigger } from '../PollingTrigger/PollingTrigger.node.js';

const fields = {
  values: [
    { name: 'email', label: '<Email>', type: 'email', required: true, placeholder: 'you@example.com', options: '' },
    { name: 'count', label: 'Count', type: 'number', required: false, placeholder: '', options: '' },
    { name: 'plan', label: 'Plan', type: 'select', required: true, placeholder: '', options: 'Free, Pro' },
  ],
};

function formContext(method: string, body: unknown = {}): IWebhookContext {
  const parameters: JsonObject = {
    fields,
    formTitle: '<script>alert(1)</script>',
    formDescription: 'Safe form',
    submitLabel: 'Send',
  };
  return {
    mode: 'trigger',
    getNodeParameter: (name: string, fallback?: unknown) => parameters[name] ?? fallback,
    getContext: () => ({}),
    getRequest: () => ({ method, path: 'form', headers: {}, query: {}, body }),
  };
}

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>
  <item><guid>one</guid><title>First</title><link>https://example.test/1</link><pubDate>Thu, 31 Jul 2026 08:00:00 GMT</pubDate></item>
  <item><guid>two</guid><title>Second</title><description>Hello</description></item>
</channel></rss>`;

describe('Form Trigger', () => {
  it('GET 生成转义后的安全表单，POST 校验并转换字段类型', async () => {
    const node = new FormTrigger();
    const page = await node.webhook.call(formContext('GET'));
    expect(page.response?.contentType).toContain('text/html');
    expect(page.response?.headers?.['Content-Security-Policy']).toContain("default-src 'none'");
    expect(page.response?.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.response?.body).not.toContain('<script>alert(1)</script>');

    const submitted = await node.webhook.call(formContext('POST', { email: 'a@example.com', count: '7', plan: 'Pro' }));
    expect(submitted.workflowData?.[0]?.json).toEqual({ email: 'a@example.com', count: 7, plan: 'Pro' });
    await expect(node.webhook.call(formContext('POST', { email: 'bad', plan: 'Root' }))).rejects.toThrow('Invalid email');
  });
});

describe('RSS nodes', () => {
  it('RSS Read 将 feed 条目解析成 items', async () => {
    const node = new RssFeedRead();
    const httpRequest = vi.fn(async () => rss);
    const context = {
      getInputData: () => [{ json: { source: 'test' } }],
      getNodeParameter: () => 'https://example.test/feed',
      helpers: { httpRequest },
    } as unknown as IExecuteContext;
    const output = await node.execute.call(context);
    expect(output[0]?.map((item) => item.json['guid'])).toEqual(['one', 'two']);
    expect(output[0]?.[0]?.pairedItem).toEqual({ item: 0 });
    expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({ urlTrust: 'user-controlled' }));
  });

  it('RSS Feed Trigger 只输出 filterNewKeys 判定的新条目', async () => {
    const node = new RssFeedReadTrigger();
    const httpRequest = vi.fn(async () => rss);
    const context = {
      getNodeParameter: () => 'https://example.test/feed',
      helpers: {
        httpRequest,
        filterNewKeys: vi.fn(async (keys: string[]) => keys.filter((key) => key === 'two')),
      },
    } as unknown as IPollContext;
    const output = await node.poll.call(context);
    expect(output?.[0]?.map((item) => item.json['guid'])).toEqual(['two']);
    expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({ urlTrust: 'user-controlled' }));
  });

  it('Polling Trigger 把用户 URL 标为严格信任边界', async () => {
    const httpRequest = vi.fn(async () => [{ id: 'one' }]);
    const context = {
      getNodeParameter: (name: string) => ({ url: 'https://example.test/items', itemsPath: '', idField: 'id' })[name],
      helpers: { httpRequest, filterNewKeys: vi.fn(async (keys: string[]) => keys) },
    } as unknown as IPollContext;
    await new PollingTrigger().poll.call(context);
    expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({ urlTrust: 'user-controlled' }));
  });
});

describe('SSE Trigger', () => {
  it('解析 JSON 事件、附加事件元数据并在关闭时释放流', async () => {
    const node = new SseTrigger();
    let listener: ((message: IEventStreamMessage) => void) | undefined;
    const close = vi.fn(async () => undefined);
    const emit = vi.fn();
    const parameters: JsonObject = { url: 'https://example.test/events', eventName: 'update', headers: { Authorization: 'Bearer test' } };
    const context = {
      getNodeParameter: (name: string) => parameters[name],
      emit,
      getWorkflowStaticData: () => ({}),
      helpers: {
        openEventStream: vi.fn(async (_options, onMessage) => {
          listener = onMessage;
          return close;
        }),
      },
    } as ITriggerContext;
    const response = await node.trigger.call(context);
    expect(context.helpers.openEventStream).toHaveBeenCalledWith(
      expect.objectContaining({ urlTrust: 'user-controlled' }),
      expect.any(Function),
    );
    listener?.({ data: '{"value":42}', event: 'other' });
    expect(emit).not.toHaveBeenCalled();
    listener?.({ data: '{"value":42}', event: 'update', id: 'evt-1' });
    expect(emit).toHaveBeenCalledWith([[{ json: { value: 42, _event: 'update', _eventId: 'evt-1' } }]]);
    await response.closeFunction?.();
    expect(close).toHaveBeenCalledOnce();
  });
});
