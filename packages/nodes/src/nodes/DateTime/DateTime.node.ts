import { DateTime as LuxonDateTime } from 'luxon';
import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { cloneJsonObject, setPath } from '../../lib/data-transform.js';
import { dateTimeDescription } from './DateTime.description.js';

type DateOperation = 'parse' | 'format' | 'add' | 'subtract';
type InputFormat = 'iso' | 'custom' | 'unixSeconds' | 'unixMilliseconds';
type OutputFormat = 'iso' | 'custom' | 'unixSeconds' | 'unixMilliseconds';
type SupportedUnit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds';

const supportedUnits = new Set<SupportedUnit>([
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
]);

function validTimezone(value: unknown): string {
  const timezone = String(value ?? 'UTC').trim() || 'UTC';
  if (!LuxonDateTime.now().setZone(timezone).isValid) {
    throw new OperationalError(`Date & Time: invalid timezone "${timezone}"`, {});
  }
  return timezone;
}

function parseDate(value: unknown, format: InputFormat, customFormat: string, timezone: string): LuxonDateTime {
  const raw = String(value ?? '').trim();
  let parsed: LuxonDateTime;
  if (format === 'unixSeconds' || format === 'unixMilliseconds') {
    const timestamp = Number(raw);
    parsed = Number.isFinite(timestamp)
      ? LuxonDateTime.fromMillis(format === 'unixSeconds' ? timestamp * 1_000 : timestamp, { zone: timezone })
      : LuxonDateTime.invalid('invalid timestamp');
  } else if (format === 'custom') {
    parsed = LuxonDateTime.fromFormat(raw, customFormat, { zone: timezone, setZone: true });
  } else {
    parsed = LuxonDateTime.fromISO(raw, { zone: timezone, setZone: true });
  }

  if (!parsed.isValid) {
    throw new OperationalError(`Date & Time: invalid date (${parsed.invalidExplanation ?? parsed.invalidReason ?? raw})`, {});
  }
  return parsed.setZone(timezone);
}

function isoValue(date: LuxonDateTime): string {
  const value = date.toISO();
  if (!value) throw new OperationalError('Date & Time: unable to serialize date', {});
  return value;
}

function formatDate(date: LuxonDateTime, outputFormat: OutputFormat, customFormat: string): string | number {
  if (outputFormat === 'unixSeconds') return Math.floor(date.toSeconds());
  if (outputFormat === 'unixMilliseconds') return date.toMillis();
  if (outputFormat === 'custom') return date.toFormat(customFormat);
  return isoValue(date);
}

export class DateTime implements INodeType {
  description = dateTimeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = input.map((item, itemIndex) => {
      const operation = String(this.getNodeParameter('operation', itemIndex, 'parse')) as DateOperation;
      const timezone = validTimezone(this.getNodeParameter('timezone', itemIndex, 'UTC'));
      const inputFormat = operation === 'parse'
        ? String(this.getNodeParameter('inputFormat', itemIndex, 'iso')) as InputFormat
        : 'iso';
      const customInputFormat = String(this.getNodeParameter('customInputFormat', itemIndex, 'yyyy-MM-dd HH:mm:ss'));
      let date = parseDate(this.getNodeParameter('date', itemIndex, ''), inputFormat, customInputFormat, timezone);

      if (operation === 'add' || operation === 'subtract') {
        const amount = Number(this.getNodeParameter('amount', itemIndex, 1));
        const unit = String(this.getNodeParameter('unit', itemIndex, 'days')) as SupportedUnit;
        if (!Number.isFinite(amount)) throw new OperationalError('Date & Time: amount must be a finite number', {});
        if (!supportedUnits.has(unit)) throw new OperationalError(`Date & Time: unsupported unit "${unit}"`, {});
        date = operation === 'add' ? date.plus({ [unit]: amount }) : date.minus({ [unit]: amount });
      }

      const result = operation === 'format'
        ? formatDate(
          date,
          String(this.getNodeParameter('outputFormat', itemIndex, 'iso')) as OutputFormat,
          String(this.getNodeParameter('customOutputFormat', itemIndex, 'yyyy-MM-dd HH:mm:ss ZZZZ')),
        )
        : isoValue(date);
      const json = cloneJsonObject(item.json);
      setPath(json, String(this.getNodeParameter('outputField', itemIndex, 'date')), result);
      return { ...item, json, pairedItem: { item: itemIndex } };
    });
    return [output];
  }
}
