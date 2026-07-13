import { describe, expect, it } from 'vitest';
import type { INodeProperties } from '@nomops/workflow';
import { isPropertyVisible } from '../display-options.js';

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
});
