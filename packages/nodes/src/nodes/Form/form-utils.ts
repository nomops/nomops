import { z } from 'zod';
import type { IBinaryData, IWebhookRequest, IWebhookResult, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export type FormFieldType = 'text' | 'email' | 'number' | 'date' | 'checkbox' | 'textarea' | 'select' | 'radio' | 'password' | 'hidden' | 'file' | 'html';

export interface IFormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder: string;
  options: string[];
  html?: string;
  acceptFileTypes?: string;
  multipleFiles?: boolean;
}

export interface IFormDefinition {
  title: string;
  description: string;
  submitLabel: string;
  fields: IFormField[];
}

const formBodySchema = z.record(
  z.union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()]),
);
const forbiddenNames = new Set(['__proto__', 'prototype', 'constructor']);

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function fieldNameFrom(label: string, index: number): string {
  const slug = label.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = /^[A-Za-z]/.test(slug) ? slug : `field_${slug}`;
  return (safe || `field_${index + 1}`).slice(0, 64);
}

function optionsFrom(row: Record<string, unknown>): string[] {
  const nested = (row['fieldOptions'] as { values?: Array<{ option?: unknown }> } | undefined)?.values;
  if (Array.isArray(nested)) return nested.map((entry) => text(entry.option).trim()).filter(Boolean);
  return text(row['options']).split(',').map((option) => option.trim()).filter(Boolean);
}

export function formDefinitionFrom(raw: unknown, values: {
  title: unknown;
  description: unknown;
  submitLabel: unknown;
}): IFormDefinition {
  const rows = ((raw as { values?: unknown[] } | null)?.values ?? []) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const fields = rows.map((row, index): IFormField => {
    const label = text(row['fieldLabel'], text(row['label'])).trim();
    const name = text(row['fieldName'], text(row['name'])).trim() || fieldNameFrom(label, index);
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) || forbiddenNames.has(name)) {
      throw new OperationalError(`Invalid form field name at row ${index + 1}`, { parameter: 'fields' });
    }
    if (seen.has(name)) throw new OperationalError(`Duplicate form field name: ${name}`, { parameter: 'fields' });
    seen.add(name);
    const rawType = text(row['fieldType'], text(row['type'], 'text'));
    const typeValue = rawType === 'dropdown' ? 'select' : rawType;
    const supported: FormFieldType[] = ['text', 'email', 'number', 'date', 'checkbox', 'textarea', 'select', 'radio', 'password', 'hidden', 'file', 'html'];
    const type: FormFieldType = supported.includes(typeValue as FormFieldType) ? typeValue as FormFieldType : 'text';
    const options = optionsFrom(row);
    if (['select', 'radio'].includes(type) && options.length === 0) {
      throw new OperationalError(`${type === 'select' ? 'Dropdown' : 'Radio'} field ${name} requires at least one option`, { parameter: 'formFields' });
    }
    return {
      name,
      label: label || name,
      type,
      required: row['requiredField'] === true || row['required'] === true,
      placeholder: text(row['placeholder']),
      options,
      ...(type === 'html' ? { html: text(row['html']) } : {}),
      ...(type === 'file' ? {
        acceptFileTypes: text(row['acceptFileTypes']),
        multipleFiles: row['multipleFiles'] === true,
      } : {}),
    };
  });
  if (fields.length === 0) throw new OperationalError('Form requires at least one field', { parameter: 'fields' });
  return {
    title: text(values.title, 'Form'),
    description: text(values.description),
    submitLabel: text(values.submitLabel, 'Submit'),
    fields,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function renderForm(definition: IFormDefinition): string {
  const controls = definition.fields.map((field) => {
    if (field.type === 'html') return `<section class="custom-html">${field.html ?? ''}</section>`;
    const required = field.required ? ' required' : '';
    const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
    let control: string;
    if (field.type === 'textarea') {
      control = `<textarea id="${field.name}" name="${field.name}"${required}${placeholder}></textarea>`;
    } else if (field.type === 'select') {
      const options = field.options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
      control = `<select id="${field.name}" name="${field.name}"${required}><option value="">Select…</option>${options}</select>`;
    } else if (field.type === 'radio') {
      control = field.options.map((option) => `<label class="choice"><input name="${field.name}" type="radio" value="${escapeHtml(option)}"${required}> ${escapeHtml(option)}</label>`).join('');
    } else if (field.type === 'checkbox') {
      control = `<input id="${field.name}" name="${field.name}" type="checkbox" value="true"${required}>`;
    } else {
      const fileOptions = field.type === 'file'
        ? `${field.acceptFileTypes ? ` accept="${escapeHtml(field.acceptFileTypes)}"` : ''}${field.multipleFiles ? ' multiple' : ''}`
        : '';
      control = `<input id="${field.name}" name="${field.name}" type="${field.type}"${required}${placeholder}${fileOptions}>`;
    }
    return `<label for="${field.name}"><span>${escapeHtml(field.label)}${field.required ? ' *' : ''}</span>${control}</label>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(definition.title)}</title><style>body{margin:0;background:#f7f7f9;color:#202124;font:15px system-ui,sans-serif}.card{box-sizing:border-box;max-width:640px;margin:48px auto;padding:32px;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 30px #0000000d}h1{margin:0 0 8px;font-size:26px}.description{margin:0 0 24px;color:#666;white-space:pre-wrap}label{display:grid;gap:7px;margin:18px 0;font-weight:600}input,textarea,select{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #bbb;border-radius:7px;background:#fff;color:#202124;font:inherit}input[type=checkbox]{width:20px;height:20px}textarea{min-height:110px;resize:vertical}button{margin-top:10px;padding:11px 20px;border:0;border-radius:7px;background:#ff6d5a;color:#fff;font:600 15px system-ui;cursor:pointer}@media(max-width:680px){.card{margin:0;min-height:100vh;border:0;border-radius:0;padding:24px}}</style></head><body><main class="card"><h1>${escapeHtml(definition.title)}</h1>${definition.description ? `<p class="description">${escapeHtml(definition.description)}</p>` : ''}<form method="post"${definition.fields.some((field) => field.type === 'file') ? ' enctype="multipart/form-data"' : ''}>${controls}<button type="submit">${escapeHtml(definition.submitLabel)}</button></form></main></body></html>`;
}

function submittedValue(body: Record<string, string | string[] | number | boolean | null>, field: IFormField): unknown {
  const raw = body[field.name];
  if (field.type === 'checkbox') return raw === true || raw === 'true' || raw === 'on';
  if (field.type === 'html') return undefined;
  const scalar = Array.isArray(raw) ? raw[0] : raw;
  const value = scalar === null || scalar === undefined ? '' : String(scalar);
  if (field.required && value.trim() === '') {
    throw new OperationalError(`Field is required: ${field.label}`, { field: field.name, status: 400 });
  }
  if (field.type === 'email' && value && !z.string().email().safeParse(value).success) {
    throw new OperationalError(`Invalid email: ${field.label}`, { field: field.name, status: 400 });
  }
  if (field.type === 'number') {
    if (value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new OperationalError(`Invalid number: ${field.label}`, { field: field.name, status: 400 });
    return number;
  }
  if (field.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OperationalError(`Invalid date: ${field.label}`, { field: field.name, status: 400 });
  }
  if (['select', 'radio'].includes(field.type) && value && !field.options.includes(value)) {
    throw new OperationalError(`Invalid option: ${field.label}`, { field: field.name, status: 400 });
  }
  return value;
}

function fileMetadata(binary: IBinaryData): JsonObject {
  return {
    filename: binary.fileName ?? 'file',
    mimetype: binary.mimeType,
    size: binary.fileSize ?? 0,
  };
}

function binaryPropertyName(field: IFormField, index?: number): string {
  const base = field.name.replace(/\W/g, '_') || 'data';
  return index === undefined ? base : `${base}_${index}`;
}

export function handleFormRequest(request: IWebhookRequest, definition: IFormDefinition): IWebhookResult {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {
      response: {
        contentType: 'text/html; charset=utf-8',
        headers: {
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
        body: request.method === 'HEAD' ? null : renderForm(definition),
      },
    };
  }
  if (request.method !== 'POST') {
    return { response: { statusCode: 405, headers: { Allow: 'GET, HEAD, POST' }, body: 'Method not allowed' } };
  }
  const parsed = formBodySchema.safeParse(request.body);
  if (!parsed.success) throw new OperationalError('Invalid form submission', { status: 400 });
  const body = parsed.data;
  const output: JsonObject = {};
  const binary: Record<string, IBinaryData> = {};
  for (const field of definition.fields) {
    if (field.type === 'file') {
      const raw = request.files?.[field.name];
      const files = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      if (field.required && files.length === 0) {
        throw new OperationalError(`Field is required: ${field.label}`, { field: field.name, status: 400 });
      }
      if (!field.multipleFiles && files.length > 1) {
        throw new OperationalError(`Only one file is allowed: ${field.label}`, { field: field.name, status: 400 });
      }
      output[field.name] = field.multipleFiles ? files.map(fileMetadata) : (files[0] ? fileMetadata(files[0]) : null);
      files.forEach((file, index) => {
        binary[binaryPropertyName(field, field.multipleFiles ? index : undefined)] = file;
      });
      continue;
    }
    const value = submittedValue(body, field);
    if (field.type !== 'html') output[field.name] = value;
  }
  return {
    workflowData: [{ json: output, ...(Object.keys(binary).length > 0 ? { binary } : {}) }],
    response: {
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
      body: '<!doctype html><meta charset="utf-8"><title>Submitted</title><body style="font:16px system-ui;padding:48px;text-align:center"><h1>Submitted</h1><p>Your response has been received.</p></body>',
    },
  };
}
