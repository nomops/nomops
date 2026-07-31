import type { JsonObject } from '@nomops/workflow';

interface IMimePart {
  headers: Record<string, string>;
  body: Buffer;
}

function splitMessage(raw: Buffer): IMimePart {
  const marker = raw.indexOf('\r\n\r\n');
  const fallback = marker < 0 ? raw.indexOf('\n\n') : marker;
  const offset = marker >= 0 ? 4 : fallback >= 0 ? 2 : raw.byteLength;
  const headerText = raw.subarray(0, fallback >= 0 ? fallback : raw.byteLength).toString('utf8');
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { headers, body: raw.subarray(Math.min(raw.byteLength, (fallback >= 0 ? fallback : raw.byteLength) + offset)) };
}

function decodeQuotedPrintable(value: string): Buffer {
  const unfolded = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < unfolded.length; index++) {
    if (unfolded[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(unfolded.charCodeAt(index));
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(part: IMimePart): Buffer {
  const encoding = part.headers['content-transfer-encoding']?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(part.body.toString('ascii').replace(/\s/g, ''), 'base64');
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(part.body.toString('latin1'));
  return part.body;
}

function headerParameter(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(new RegExp(`(?:^|;)\\s*${name}=(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return match?.[1] ?? match?.[2];
}

function decodeHeader(value: string | undefined): string {
  return (value ?? '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_match, _charset, encoding: string, payload: string) => {
    try {
      return encoding.toLowerCase() === 'b'
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeQuotedPrintable(payload.replaceAll('_', ' ')).toString('utf8');
    } catch {
      return payload;
    }
  });
}

function multipartParts(body: Buffer, boundary: string): Buffer[] {
  const marker = `--${boundary}`;
  return body
    .toString('latin1')
    .split(marker)
    .slice(1)
    .map((part) => part.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
    .filter((part) => part && part !== '--')
    .map((part) => Buffer.from(part.replace(/--$/, ''), 'latin1'));
}

function collectContent(part: IMimePart, output: { text: string[]; html: string[]; attachments: JsonObject[] }): void {
  const contentType = part.headers['content-type'] ?? 'text/plain';
  const mimeType = contentType.split(';')[0]!.trim().toLowerCase();
  const boundary = headerParameter(contentType, 'boundary');
  if (mimeType.startsWith('multipart/') && boundary) {
    for (const child of multipartParts(part.body, boundary)) collectContent(splitMessage(child), output);
    return;
  }
  const disposition = part.headers['content-disposition'] ?? '';
  const fileName = decodeHeader(headerParameter(disposition, 'filename') ?? headerParameter(contentType, 'name'));
  const content = decodeBody(part);
  if (fileName || /^attachment/i.test(disposition)) {
    output.attachments.push({ fileName: fileName || 'attachment.bin', mimeType, size: content.byteLength });
  } else if (mimeType === 'text/html') {
    output.html.push(content.toString('utf8'));
  } else if (mimeType === 'text/plain') {
    output.text.push(content.toString('utf8'));
  }
}

export function parseEmail(raw: Buffer, uid: number, format: string): JsonObject {
  const root = splitMessage(raw);
  if (format === 'raw') {
    return {
      uid,
      messageId: decodeHeader(root.headers['message-id']),
      raw: raw.toString('base64url'),
    };
  }
  const content = { text: [] as string[], html: [] as string[], attachments: [] as JsonObject[] };
  collectContent(root, content);
  const date = new Date(root.headers['date'] ?? '');
  return {
    uid,
    messageId: decodeHeader(root.headers['message-id']),
    subject: decodeHeader(root.headers['subject']),
    from: decodeHeader(root.headers['from']),
    to: decodeHeader(root.headers['to']),
    cc: decodeHeader(root.headers['cc']),
    date: Number.isNaN(date.valueOf()) ? null : date.toISOString(),
    text: content.text.join('\n'),
    html: content.html.join('\n'),
    attachments: content.attachments,
  };
}
