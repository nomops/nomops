export interface ParsedCurlParameters {
  [key: string]: unknown;
  method: string;
  url: string;
  authentication: 'none';
  sendQuery: boolean;
  specifyQuery: 'keypair';
  queryParameters: { parameters: Array<{ name: string; value: unknown }> };
  sendHeaders: boolean;
  specifyHeaders: 'keypair';
  headerParameters: { parameters: Array<{ name: string; value: unknown }> };
  sendBody: boolean;
  contentType?: 'json' | 'form-urlencoded' | 'raw';
  specifyBody?: 'keypair' | 'json';
  bodyParameters?: { parameters: Array<{ name: string; value: unknown }> };
  jsonBody?: unknown;
  rawBody?: string;
  options: Record<string, unknown>;
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  const push = () => {
    if (token) tokens.push(token);
    token = '';
  };
  for (const char of command.trim()) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }
    if (/\s/.test(char) && quote === null) push();
    else token += char;
  }
  if (escaped) token += '\\';
  if (quote) throw new Error('The cURL command has an unterminated quote');
  push();
  return tokens;
}

function headerRow(value: string): { name: string; value: string } {
  const colon = value.indexOf(':');
  if (colon <= 0) throw new Error(`Invalid cURL header: ${value}`);
  return { name: value.slice(0, colon).trim(), value: value.slice(colon + 1).trim() };
}

function rowsOf(value: Record<string, unknown>): Array<{ name: string; value: unknown }> {
  return Object.entries(value).map(([name, rowValue]) => ({ name, value: rowValue }));
}

/** Parse the cURL subset exposed by the HTTP Request importer. */
export function parseCurlCommand(command: string): ParsedCurlParameters {
  const tokens = tokenize(command);
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('The command must start with curl');
  let method = '';
  let urlText = '';
  let bodyText: string | null = null;
  let forceGet = false;
  const headers: Array<{ name: string; value: string }> = [];

  const takeValue = (index: number, inline?: string): [string, number] => {
    if (inline !== undefined) return [inline, index];
    const value = tokens[index + 1];
    if (value === undefined) throw new Error(`Missing value after ${tokens[index]}`);
    return [value, index + 1];
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    const [flag, inline] = token.startsWith('--') && token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, undefined];
    if (flag === '-X' || flag === '--request') {
      const [value, next] = takeValue(i, inline); method = value.toUpperCase(); i = next;
    } else if (flag.startsWith('-X') && flag.length > 2) {
      method = flag.slice(2).toUpperCase();
    } else if (flag === '--url') {
      const [value, next] = takeValue(i, inline); urlText = value; i = next;
    } else if (flag === '-H' || flag === '--header') {
      const [value, next] = takeValue(i, inline); headers.push(headerRow(value)); i = next;
    } else if (flag.startsWith('-H') && flag.length > 2) {
      headers.push(headerRow(flag.slice(2)));
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(flag)) {
      const [value, next] = takeValue(i, inline); bodyText = bodyText === null ? value : `${bodyText}&${value}`; i = next;
    } else if (flag === '-G' || flag === '--get') {
      forceGet = true;
    } else if (flag === '-u' || flag === '--user') {
      const [value, next] = takeValue(i, inline);
      headers.push({ name: 'Authorization', value: `Basic ${btoa(value)}` });
      i = next;
    } else if (!flag.startsWith('-') && !urlText) {
      urlText = flag;
    }
  }

  if (!urlText) throw new Error('The cURL command does not contain a URL');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('The cURL URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Only HTTP and HTTPS cURL URLs are supported');

  const queryRows = [...parsedUrl.searchParams.entries()].map(([name, value]) => ({ name, value }));
  parsedUrl.search = '';
  const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === 'content-type');
  const requestHeaders = bodyText === null
    ? headers
    : headers.filter((header) => header.name.toLowerCase() !== 'content-type');
  const result: ParsedCurlParameters = {
    method: forceGet ? 'GET' : method || (bodyText === null ? 'GET' : 'POST'),
    url: parsedUrl.toString().replace(/\/$/, parsedUrl.pathname === '/' ? '' : '/'),
    authentication: 'none',
    sendQuery: queryRows.length > 0,
    specifyQuery: 'keypair',
    queryParameters: { parameters: queryRows },
    sendHeaders: requestHeaders.length > 0,
    specifyHeaders: 'keypair',
    headerParameters: { parameters: requestHeaders },
    sendBody: bodyText !== null && !forceGet,
    options: {},
  };

  if (bodyText !== null && !forceGet) {
    const contentType = contentTypeHeader?.value.toLowerCase() ?? '';
    if (contentType.includes('application/json') || /^[\[{]/.test(bodyText.trim())) {
      try {
        const value = JSON.parse(bodyText) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)
          && Object.values(value as Record<string, unknown>).every((item) => item === null || typeof item !== 'object')) {
          result.contentType = 'json';
          result.specifyBody = 'keypair';
          result.bodyParameters = { parameters: rowsOf(value as Record<string, unknown>) };
        } else {
          result.contentType = 'json';
          result.specifyBody = 'json';
          result.jsonBody = value;
        }
      } catch {
        result.contentType = 'raw';
        result.rawBody = bodyText;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      result.contentType = 'form-urlencoded';
      result.specifyBody = 'keypair';
      result.bodyParameters = { parameters: [...new URLSearchParams(bodyText)].map(([name, value]) => ({ name, value })) };
    } else {
      result.contentType = 'raw';
      result.rawBody = bodyText;
    }
  }
  return result;
}
