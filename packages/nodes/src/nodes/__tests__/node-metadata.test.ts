import { describe, expect, it } from 'vitest';
import { builtinNodeManifest } from '../../manifest.js';

describe('节点声明式面板元数据', () => {
  it('所有可见内置节点都声明至少一个面板分类', () => {
    const missing = builtinNodeManifest
      .filter(({ description }) => !description.hidden)
      .filter(({ description }) => !description.categories?.length)
      .map(({ type }) => type);

    expect(missing).toEqual([]);
  });

  it('filter 与 assignmentCollection 是一等 DSL 类型', () => {
    const descriptions = new Map(builtinNodeManifest.map(({ type, description }) => [type, description]));
    expect(descriptions.get('nomops.if')?.properties.find(({ name }) => name === 'conditions')?.type).toBe('filter');
    expect(descriptions.get('nomops.switch')?.properties.find(({ name }) => name === 'rules')?.type).toBe('filter');
    expect(descriptions.get('nomops.set')?.properties.find(({ name }) => name === 'fields')?.type).toBe('assignmentCollection');
  });
});
