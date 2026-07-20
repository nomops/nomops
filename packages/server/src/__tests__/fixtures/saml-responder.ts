import { SignedXml } from 'xml-crypto';
import { randomUUID } from 'node:crypto';
import { TEST_IDP_CERTIFICATE, TEST_IDP_PRIVATE_KEY } from './saml-idp.js';

/**
 * 测试用的假 IdP：产出**真正签过名**的 SAML Response。
 *
 * 没有它就只能测「配置能存」这类浅表行为。SAML 的全部价值在于那几条安全性质
 * （签名有效、断言未被篡改、不能重放、受众正确、未过期），而这些只有拿真断言
 * 打过去才验得出来。
 */

export interface IAssertionOptions {
  email?: string;
  firstName?: string;
  lastName?: string;
  /** SP 的 EntityID；不匹配时应被拒。 */
  audience: string;
  /** 回调地址（Recipient）。 */
  destination: string;
  /** 对应 SP 发出的 AuthnRequest id；伪造/重放测试靠它。 */
  inResponseTo: string;
  /** 断言失效时刻；传过去的时间即可造「已过期」。 */
  notOnOrAfter?: Date;
  issuer?: string;
  /** 用别的私钥签（模拟攻击者）。 */
  signingKey?: string;
  /** 不签名（模拟裸断言注入）。 */
  unsigned?: boolean;
  /**
   * 只签外层 Response、不签 Assertion——签名包装攻击的形态：
   * 外层看起来「签过了」，但真正承载身份的断言不受签名保护。
   * SP 若只检查「有没有签名」而不检查「断言本身签没签」，就会被这招骗过。
   */
  signResponseOnly?: boolean;
  /** 签完之后再篡改邮箱——签名与内容不再匹配，必须被拒。 */
  tamperEmailAfterSigning?: string;
}

const ATTR = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
};

function attribute(name: string, value: string): string {
  return `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
      <saml:AttributeValue xsi:type="xs:string">${value}</saml:AttributeValue>
    </saml:Attribute>`;
}

/** 组一份未签名的 Response XML。 */
function buildXml(options: IAssertionOptions): { xml: string; assertionId: string } {
  const now = new Date();
  const notOnOrAfter = options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const notBefore = new Date(now.getTime() - 60_000);
  const assertionId = `_${randomUUID()}`;
  const responseId = `_${randomUUID()}`;
  const issuer = options.issuer ?? 'https://idp.test/entity';
  const email = options.email ?? 'saml.user@test.dev';

  const attributes = [
    attribute(ATTR.email, email),
    ...(options.firstName ? [attribute(ATTR.firstName, options.firstName)] : []),
    ...(options.lastName ? [attribute(ATTR.lastName, options.lastName)] : []),
  ].join('\n    ');

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${options.destination}" InResponseTo="${options.inResponseTo}">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">
    <saml:Issuer>${issuer}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter.toISOString()}" Recipient="${options.destination}" InResponseTo="${options.inResponseTo}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${notBefore.toISOString()}" NotOnOrAfter="${notOnOrAfter.toISOString()}">
      <saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${assertionId}">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
    ${attributes}
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

  return { xml, assertionId };
}

/** 产出 base64 的 SAMLResponse，可直接作为表单字段 POST。 */
export function buildSamlResponse(options: IAssertionOptions): string {
  const { xml, assertionId } = buildXml(options);

  let signed = xml;
  if (!options.unsigned) {
    const signAssertion = !options.signResponseOnly;
    const sig = new SignedXml({
      privateKey: options.signingKey ?? TEST_IDP_PRIVATE_KEY,
      publicCert: TEST_IDP_CERTIFICATE,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: signAssertion
        ? `//*[local-name(.)='Assertion' and @ID='${assertionId}']`
        : `//*[local-name(.)='Response']`,
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });
    sig.computeSignature(xml, {
      location: signAssertion
        ? { reference: `//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']`, action: 'after' }
        : { reference: `//*[local-name(.)='Response']/*[local-name(.)='Issuer']`, action: 'after' },
    });
    signed = sig.getSignedXml();
  }

  // 签名之后改内容：签名覆盖的摘要不再匹配，校验必须失败
  if (options.tamperEmailAfterSigning) {
    signed = signed.replace(
      /saml\.user@test\.dev|>[^<]*@[^<]*</g,
      (match) => (match.startsWith('>') ? `>${options.tamperEmailAfterSigning}<` : options.tamperEmailAfterSigning!),
    );
  }

  return Buffer.from(signed, 'utf8').toString('base64');
}
