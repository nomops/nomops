import type { CredentialView, TemplateCredentialRequirement } from '../api/client.js';

/**
 * 模板向导的保守自动填充：同类型只有一个候选时可确定；多个候选时只有名称
 * 唯一精确匹配才可确定。任何歧义都交给用户选择。
 */
export function chooseTemplateCredential(
  requirement: TemplateCredentialRequirement,
  credentials: CredentialView[],
): CredentialView | null {
  const candidates = credentials.filter((credential) => credential.type === requirement.credentialType);
  const expectedName = requirement.credentialName.trim().toLocaleLowerCase();
  const exact = candidates.filter(
    (credential) => credential.name.trim().toLocaleLowerCase() === expectedName,
  );
  if (exact.length === 1) return exact[0]!;
  if (candidates.length === 1) return candidates[0]!;
  return null;
}
