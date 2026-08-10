import type { ICredentialAuthentication, INodeTypeDescription } from '@nomops/workflow';

/**
 * 集成凭证的认证方式只在这里声明一次。节点只列 credentials.name，工厂按类型挂接认证。
 * 这些是模板元数据，不含任何凭证明文；真实值仅在 core routing 发送请求前短暂物化。
 */
export const integrationCredentialAuthentications: Readonly<Record<string, ICredentialAuthentication>> = {
  slackApi: {
    credentialName: 'slackApi',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{accessToken}}' }],
  },
  githubApi: {
    credentialName: 'githubApi',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{accessToken}}' }],
  },
  sendGridApi: {
    credentialName: 'sendGridApi',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{apiKey}}' }],
  },
  stripeApi: {
    credentialName: 'stripeApi',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{secretKey}}' }],
  },
  notionApi: {
    credentialName: 'notionApi',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{apiKey}}' }],
  },
  telegramApi: {
    credentialName: 'telegramApi',
    injections: [{ in: 'path', key: 'botToken', template: '{{accessToken}}' }],
  },
  googleSheetsOAuth2Api: {
    credentialName: 'googleSheetsOAuth2Api',
    injections: [{ in: 'header', key: 'authorization', template: 'Bearer {{access_token}}' }],
  },
};

/** 给声明式集成挂上凭证类型认证，并统一开放 usableAsTool。 */
export function integrationDescription(description: INodeTypeDescription): INodeTypeDescription {
  const credentialName = description.credentials?.[0]?.name;
  const authentication = credentialName ? integrationCredentialAuthentications[credentialName] : undefined;
  return {
    ...description,
    usableAsTool: true,
    ...(authentication ? { credentialAuthentication: authentication } : {}),
  };
}
