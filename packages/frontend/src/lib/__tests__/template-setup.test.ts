import { describe, expect, it } from 'vitest';
import type { CredentialView, TemplateCredentialRequirement } from '../../api/client.js';
import { chooseTemplateCredential } from '../template-setup.js';

const requirement: TemplateCredentialRequirement = {
  id: 'anthropic-model',
  credentialType: 'anthropicApi',
  credentialName: 'Anthropic API',
  nodeNames: ['Model A', 'Model B'],
};

const credential = (id: string, name: string, type = 'anthropicApi'): CredentialView => ({
  id,
  name,
  type,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
});

describe('template credential auto selection', () => {
  it('selects the only credential of the required type', () => {
    expect(chooseTemplateCredential(requirement, [
      credential('smtp', 'Mail', 'smtp'),
      credential('anthropic', 'Production Claude'),
    ])?.id).toBe('anthropic');
  });

  it('selects one exact name match among multiple same-type credentials', () => {
    expect(chooseTemplateCredential(requirement, [
      credential('dev', 'Claude dev'),
      credential('exact', 'anthropic api'),
    ])?.id).toBe('exact');
  });

  it('leaves ambiguous or missing choices empty', () => {
    expect(chooseTemplateCredential(requirement, [
      credential('dev', 'Claude dev'),
      credential('prod', 'Claude prod'),
    ])).toBeNull();
    expect(chooseTemplateCredential(requirement, [credential('smtp', 'Mail', 'smtp')])).toBeNull();
  });
});
