import { describe, expect, it } from 'vitest';
import { describeTransformInputSchema } from './ai-transform.js';

describe('AI Transform input schema summary', () => {
  it('returns bounded paths and types without any raw values', () => {
    const schema = describeTransformInputSchema([
      { json: { email: 'secret@example.com', profile: { age: 42, active: true }, tags: ['private-tag'] } },
      { json: { email: 'another@example.com', profile: { age: 'unknown', active: false }, tags: [] } },
    ]);
    expect(schema).toEqual(expect.arrayContaining([
      { path: 'email', type: 'string' },
      { path: 'profile', type: 'object' },
      { path: 'profile.age', type: 'mixed' },
      { path: 'profile.active', type: 'boolean' },
      { path: 'tags', type: 'array' },
      { path: 'tags[]', type: 'string' },
    ]));
    expect(JSON.stringify(schema)).not.toMatch(/secret@example|private-tag|42/);
  });

  it('caps the summary at one hundred fields', () => {
    const json = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`field${index}`, index]));
    expect(describeTransformInputSchema([{ json }])).toHaveLength(100);
  });
});
