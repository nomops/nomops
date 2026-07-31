import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

function csvCell(value: unknown, delimiter: string): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function recordsToCsv(records: JsonObject[], delimiter = ','): Buffer {
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const lines = [headers.map((header) => csvCell(header, delimiter)).join(delimiter)];
  for (const record of records) lines.push(headers.map((header) => csvCell(record[header], delimiter)).join(delimiter));
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function parseCsvRows(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new OperationalError('Extract from File: CSV contains an unterminated quoted field', {});
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function primitive(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) as unknown; } catch { return text; }
  }
  return text;
}

export function csvToRecords(buffer: Uint8Array, delimiter = ','): JsonObject[] {
  if (delimiter.length !== 1) throw new OperationalError('CSV delimiter must be one character', {});
  const rows = parseCsvRows(Buffer.from(buffer).toString('utf8').replace(/^\uFEFF/, ''), delimiter);
  const headers = rows.shift() ?? [];
  return rows.filter((row) => row.some((cell) => cell !== '')).map((row) => {
    const record: JsonObject = {};
    headers.forEach((header, index) => { if (header) record[header] = primitive(row[index] ?? ''); });
    return record;
  });
}

export async function recordsToXlsx(records: JsonObject[], sheetName = 'Sheet1'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Sheet1');
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  sheet.addRow(headers);
  for (const record of records) {
    sheet.addRow(headers.map((header) => {
      const value = record[header];
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value as ExcelJS.CellValue;
    }));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function excelValue(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    if ('result' in value) return excelValue(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return typeof value === 'string' ? primitive(value) : value;
}

export async function xlsxToRecords(buffer: Uint8Array, sheetName?: string): Promise<JsonObject[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) throw new OperationalError('Extract from File: workbook has no matching worksheet', {});
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column - 1] = String(cell.value ?? ''); });
  const records: JsonObject[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: JsonObject = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = excelValue(row.getCell(index + 1).value);
      if (value !== null && value !== '') hasValue = true;
      record[header] = value;
    });
    if (hasValue) records.push(record);
  });
  return records;
}

export async function extractPdfText(buffer: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require = createRequire(import.meta.url);
  const standardFontDataUrl = `${dirname(require.resolve('pdfjs-dist/standard_fonts/FoxitFixed.pfb'))}${sep}`;
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, standardFontDataUrl });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').filter(Boolean).join(' '));
    }
    return { text: pages.join('\n'), pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}
