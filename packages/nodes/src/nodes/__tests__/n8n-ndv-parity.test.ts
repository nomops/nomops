import { describe, expect, it } from 'vitest';
import { manualTriggerDescription } from '../ManualTrigger/ManualTrigger.description.js';
import { scheduleDescription } from '../Schedule/Schedule.description.js';
import { scheduleConfigFromParameters, scheduleConfigsFromParameters } from '../../lib/schedule-config.js';
import { webhookDescription } from '../Webhook/Webhook.description.js';
import { httpRequestDescription } from '../HttpRequest/HttpRequest.description.js';
import { setDescription } from '../Set/Set.description.js';
import { ifDescription } from '../If/If.description.js';
import { switchDescription } from '../Switch/Switch.description.js';
import { codeDescription } from '../Code/Code.description.js';

const names = (description: { properties: Array<{ displayName: string }> }) =>
  description.properties.map((property) => property.displayName);

describe('n8n NDV 第二批参数基线', () => {
  it('Manual Trigger 使用 n8n 节点名且没有参数', () => {
    expect(manualTriggerDescription.defaults.name).toBe('When clicking ‘Execute workflow’');
    expect(manualTriggerDescription.properties).toEqual([]);
  });

  it('高频节点按 n8n 的 Parameters 可见顺序声明', () => {
    expect(names(scheduleDescription)).toEqual(expect.arrayContaining(['Trigger Rules']));
    expect(names(webhookDescription).slice(0, 4)).toEqual(['HTTP Method', 'Path', 'Authentication', 'Respond']);
    expect(names(httpRequestDescription).slice(0, 5)).toEqual([
      'Method', 'URL', 'Authentication', 'Send Query Parameters', 'Specify Query Parameters',
    ]);
    expect(names(setDescription).slice(0, 4)).toEqual([
      'Mode', 'Fields to Set', 'JSON Output', 'Include Other Input Fields',
    ]);
    expect(names(ifDescription)).toEqual(['Conditions', 'Convert types where required', 'Options']);
    expect(ifDescription.properties.find((property) => property.name === 'conditions')?.default).toHaveLength(1);
    expect(names(switchDescription).slice(0, 4)).toEqual([
      'Mode', 'Routing Rules', 'Output Index', 'Convert types where required',
    ]);
    expect(switchDescription.properties.find((property) => property.name === 'rules')?.default).toHaveLength(1);
    expect(names(codeDescription).slice(0, 3)).toEqual(['Mode', 'Language', 'JavaScript']);
  });

  it('Schedule Trigger Rules 归一化为持久调度配置并兼容旧参数', () => {
    expect(scheduleConfigFromParameters({ rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }))
      .toEqual({ mode: 'interval', everySeconds: 900 });
    expect(scheduleConfigFromParameters({ rule: { interval: [{ field: 'hours', hoursInterval: 6, triggerAtMinute: 10 }] } }))
      .toEqual({ mode: 'cron', cron: '10 */6 * * *' });
    expect(scheduleConfigFromParameters({ mode: 'cron', cronExpression: '0 9 * * *' }))
      .toEqual({ mode: 'cron', cron: '0 9 * * *' });
    expect(scheduleConfigsFromParameters({ rule: { interval: [
      { field: 'seconds', secondsInterval: 30 },
      { field: 'minutes', minutesInterval: 2 },
    ] } })).toEqual([
      { mode: 'interval', everySeconds: 30 },
      { mode: 'interval', everySeconds: 120 },
    ]);
  });
});
