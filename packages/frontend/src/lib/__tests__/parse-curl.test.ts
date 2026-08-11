import { describe, expect, it } from 'vitest';
import { parseCurlCommand } from '../parse-curl.js';

describe('HTTP Request cURL importer', () => {
  it('拆分 method、URL query、headers 和扁平 JSON body', () => {
    const parsed = parseCurlCommand(
      "curl -X POST 'https://api.example.com/items?limit=5' -H 'Authorization: Bearer token' -H 'Content-Type: application/json' --data-raw '{\"name\":\"demo\"}'",
    );
    expect(parsed).toMatchObject({
      method: 'POST', url: 'https://api.example.com/items', sendQuery: true, sendHeaders: true, sendBody: true,
      queryParameters: { parameters: [{ name: 'limit', value: '5' }] },
      headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer token' }] },
      contentType: 'json', specifyBody: 'keypair',
      bodyParameters: { parameters: [{ name: 'name', value: 'demo' }] },
    });
  });

  it('无 -X 时有 data 推断 POST，嵌套 JSON 使用 JSON Body', () => {
    const parsed = parseCurlCommand("curl https://api.example.com -d '{\"nested\":{\"ok\":true}}'");
    expect(parsed.method).toBe('POST');
    expect(parsed.specifyBody).toBe('json');
    expect(parsed.jsonBody).toEqual({ nested: { ok: true } });
  });

  it('拒绝非 cURL、缺 URL 和未闭合引号', () => {
    expect(() => parseCurlCommand('wget https://example.com')).toThrow(/start with curl/);
    expect(() => parseCurlCommand('curl -X POST')).toThrow(/does not contain a URL/);
    expect(() => parseCurlCommand("curl 'https://example.com")).toThrow(/unterminated quote/);
  });
});
