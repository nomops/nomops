export type ScheduleConfig =
  | { mode: 'interval'; everySeconds: number }
  | { mode: 'cron'; cron: string };

function positive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function scheduleConfigFromRule(first: Record<string, unknown>): ScheduleConfig {
  const field = String(first['field'] ?? 'days');
  if (field === 'seconds') return { mode: 'interval', everySeconds: positive(first['secondsInterval'], 30) };
  if (field === 'minutes') return { mode: 'interval', everySeconds: positive(first['minutesInterval'], 5) * 60 };
  if (field === 'hours') {
    return { mode: 'cron', cron: `${Math.min(59, Math.max(0, Number(first['triggerAtMinute']) || 0))} */${positive(first['hoursInterval'], 1)} * * *` };
  }
  if (field === 'weeks') {
    const minute = Math.min(59, Math.max(0, Number(first['triggerAtMinute']) || 0));
    const hour = Math.min(23, Math.max(0, Number(first['triggerAtHour']) || 0));
    const day = Math.min(6, Math.max(0, Number(first['triggerAtDay']) || 1));
    return { mode: 'cron', cron: `${minute} ${hour} * * ${day}` };
  }
  if (field === 'months') {
    const minute = Math.min(59, Math.max(0, Number(first['triggerAtMinute']) || 0));
    const hour = Math.min(23, Math.max(0, Number(first['triggerAtHour']) || 0));
    const day = Math.min(31, Math.max(1, Number(first['triggerAtDayOfMonth']) || 1));
    return { mode: 'cron', cron: `${minute} ${hour} ${day} */${positive(first['monthsInterval'], 1)} *` };
  }
  if (field === 'cronExpression') return { mode: 'cron', cron: String(first['expression'] ?? '0 0 * * *') };
  const minute = Math.min(59, Math.max(0, Number(first['triggerAtMinute']) || 0));
  const hour = Math.min(23, Math.max(0, Number(first['triggerAtHour']) || 0));
  return { mode: 'cron', cron: `${minute} ${hour} */${positive(first['daysInterval'], 1)} * *` };
}

/** New Trigger Rules parameters and legacy schedule parameters share runtime representations. */
export function scheduleConfigsFromParameters(parameters: Record<string, unknown>): ScheduleConfig[] {
  const rule = parameters['rule'];
  const rows = rule && typeof rule === 'object' && !Array.isArray(rule)
    ? (rule as { interval?: unknown }).interval
    : undefined;
  const configs = Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)).map(scheduleConfigFromRule)
    : [];
  if (configs.length > 0) return configs;
  return [parameters['mode'] === 'cron'
    ? { mode: 'cron', cron: String(parameters['cronExpression'] ?? '*/5 * * * *') }
    : { mode: 'interval', everySeconds: positive(parameters['intervalSeconds'], 60) }];
}

/** Backward-compatible single-rule accessor used by the in-node manual trigger path. */
export function scheduleConfigFromParameters(parameters: Record<string, unknown>): ScheduleConfig {
  return scheduleConfigsFromParameters(parameters)[0]!;
}
