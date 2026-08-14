import { describe, expect, it } from 'vitest';
import type { INodeProperties } from '@nomops/workflow';
import { checkDisplayConditions, isPropertyVisible } from '../display-options.js';

const methodProp: INodeProperties = {
  displayName: 'Method',
  name: 'method',
  type: 'options',
  default: 'GET',
  options: [
    { name: 'GET', value: 'GET' },
    { name: 'POST', value: 'POST' },
  ],
};

const bodyProp: INodeProperties = {
  displayName: 'Body',
  name: 'body',
  type: 'json',
  default: {},
  displayOptions: { hide: { method: ['GET'] } },
};

const advancedProp: INodeProperties = {
  displayName: 'Advanced',
  name: 'advanced',
  type: 'string',
  default: '',
  displayOptions: { show: { mode: ['expert'] } },
};

const modeProp: INodeProperties = {
  displayName: 'Mode',
  name: 'mode',
  type: 'options',
  default: 'simple',
  options: [],
};

const all = [methodProp, bodyProp, advancedProp, modeProp];

describe('displayOptions 条件显示（NDV 驱动逻辑）', () => {
  it('无 displayOptions 恒显示', () => {
    expect(isPropertyVisible(methodProp, {}, all)).toBe(true);
  });

  it('hide：method=GET 时隐藏 body（参数未填时取 default 判定）', () => {
    expect(isPropertyVisible(bodyProp, {}, all)).toBe(false); // default GET
    expect(isPropertyVisible(bodyProp, { method: 'GET' }, all)).toBe(false);
    expect(isPropertyVisible(bodyProp, { method: 'POST' }, all)).toBe(true);
  });

  it('show：mode=expert 才显示 advanced', () => {
    expect(isPropertyVisible(advancedProp, {}, all)).toBe(false); // default simple
    expect(isPropertyVisible(advancedProp, { mode: 'expert' }, all)).toBe(true);
  });

  it('支持基线的全部 _cnd 操作符', () => {
    expect(checkDisplayConditions([{ _cnd: { eq: 3 } }], [3])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { not: 3 } }], [4])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { gte: 3 } }], [3, 4])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { lte: 3 } }], [2, 3])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { gt: 3 } }], [4])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { lt: 3 } }], [2])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { between: { from: 2, to: 5 } } }], [2, 4, 5])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { includes: 'work' } }], ['workflow'])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { startsWith: 'nom' } }], ['nomops'])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { endsWith: 'ops' } }], ['nomops'])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { regex: '^nom.*s$' } }], ['nomops'])).toBe(true);
    expect(checkDisplayConditions([{ _cnd: { exists: true } }], ['value'])).toBe(true);

    expect(checkDisplayConditions([{ _cnd: { gte: 3 } }], [3, 2])).toBe(false);
    expect(checkDisplayConditions([{ _cnd: { exists: true } }], [''])).toBe(false);
    expect(checkDisplayConditions([{ _cnd: { regex: '[' } }], ['safe'])).toBe(false);
  });

  it('@version 支持精确值和 _cnd 范围，使用节点保存的 typeVersion', () => {
    const v1Only: INodeProperties = {
      displayName: 'Legacy', name: 'legacy', type: 'string', default: '',
      displayOptions: { show: { '@version': [1] } },
    };
    const v2Plus: INodeProperties = {
      displayName: 'Modern', name: 'modern', type: 'string', default: '',
      displayOptions: { show: { '@version': [{ _cnd: { gte: 2 } }] } },
    };
    expect(isPropertyVisible(v1Only, {}, all, { nodeVersion: 1 })).toBe(true);
    expect(isPropertyVisible(v1Only, {}, all, { nodeVersion: 2 })).toBe(false);
    expect(isPropertyVisible(v2Plus, {}, all, { nodeVersion: 1 })).toBe(false);
    expect(isPropertyVisible(v2Plus, {}, all, { nodeVersion: 2 })).toBe(true);
    expect(isPropertyVisible(v2Plus, {}, all, { nodeVersion: 3 })).toBe(true);
  });

  it('版本门控优先于表达式保守显示', () => {
    const gated: INodeProperties = {
      displayName: 'Gated', name: 'gated', type: 'string', default: '',
      displayOptions: { show: {
        mode: ['expert'],
        '@version': [{ _cnd: { gte: 2 } }],
      } },
    };
    expect(isPropertyVisible(gated, { mode: '={{ $json.mode }}' }, all, { nodeVersion: 1 })).toBe(false);
    expect(isPropertyVisible(gated, { mode: '={{ $json.mode }}' }, all, { nodeVersion: 2 })).toBe(true);
  });

  it('表达式控制值无法静态判断时不误隐藏字段', () => {
    expect(isPropertyVisible(advancedProp, { mode: '={{ $json.mode }}' }, all)).toBe(true);
    expect(isPropertyVisible(bodyProp, { method: '={{ $json.method }}' }, all)).toBe(true);
  });

  it('/ 根路径和点路径读取节点根参数', () => {
    const nested: INodeProperties = {
      displayName: 'Nested', name: 'nested', type: 'string', default: '',
      displayOptions: { show: { '/config.level': [{ _cnd: { gte: 2 } }] } },
    };
    expect(isPropertyVisible(nested, {}, [nested], {
      rootParams: { config: { level: 2 } },
    })).toBe(true);
    expect(isPropertyVisible(nested, {}, [nested], {
      rootParams: { config: { level: 1 } },
    })).toBe(false);
  });
});
