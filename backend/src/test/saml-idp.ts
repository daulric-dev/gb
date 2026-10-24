import { randomUUID } from 'node:crypto';
import { signSamlPost } from '@node-saml/node-saml/lib/saml-post-signing';

/**
 * A pretend SAML identity provider for tests and local smoke runs: two
 * throwaway self-signed keypairs (test only, never trusted anywhere) and a
 * SAMLResponse builder that signs the assertion like a real IdP.
 */
export const TEST_IDP = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMb81KYuCc5yIe
DlPeu6EvOlfIUhxKmbhP8edfNyBFut9fw9r7E9QrSOvuMboVGnczdQytJjxKJiAl
1Yar/1eoWqMQTwX7UzT4PcxIkBhX2bxmj19FhJJ0b40YPWpCF3aJP22nyKEsr4iU
ewcPEQ2VtzIuFqU2FVd3qnHu7WN/darRFcsfvOsU2hyaWuQJcn7eD4YNu9XZjjOc
jI+e/u/YV+XMnKxNflEsocqJX/lISBqPCiGiI+cTKY+5O6wWa6mU8BGK0ZZXQb6o
wVj4jf9h1WkfU/m6mKcZum1f0L2vBlQLu+PvTbwH9273NLihz7vrZseGUqdYC4SG
w0ykAq13AgMBAAECggEAGLQ4GCxBl8g+46ugjE9UQNMSCw6KpILa/dEvYrv3RNzl
G1sAI+eujHi06/86XSj9LAOcmb7enyqKwC0KFiqCOH7NLXrBMh9Gc56nV2JlrdqC
/kWdPETgYHQZDVkMXpjzBJywRPIRjCNKstfbe4aD7cC+poXcRSHG86l7hkyjEpIV
HIFhUjXfiZSyJzwKjtVERMbof9wCMZ2dYKPkscmVOwHIXpqaPs1il/6PCJlr37TO
/O2xIT4eJodKxie9RK8l5MEE7zO8C45x/BtkA7UnTnQRU165nJbmCNgoWnWduPWp
o+dUNcaU3dzl88BoG2M8OlbKpSUw7N5KN9dEhYZ93QKBgQDEgA4z7h1MF73brF/S
vHeeuJRJ7ggPTuoxvG3sL4N8uOx99OibJKvs8wJDIwCm8unxNjmfMLB7RMQGk6e+
vMEFjTK0c+dSul7Ps4+A9MWRqHxlYo4Oaqxq3je/5gLT5fRzRbIT3ErO56piVSw1
8WGA08QuZPwkWxONCuNSeCOW3QKBgQC29etWaAMs6ED/xKPnNlsrPt6tdNyIfuXk
ZxSr8ojweQI6/UPi8KvmZfyuiL98Di7WKJoD3xCB8TSe4zF1AeZckvM1ZxuT6e4J
EhkueJT3XVGDkRIm+OizqUIv/8XZNQPUovna+Zn6c28KG/f4ZVKmC4sr3ihmUbCx
9zICNuhOYwKBgHAz5uhEOTpv/BtprDW7JFrfbt1gK/4Bw7yuqd3Jq70WIwQxSnj8
Uae1gz8ux3qNDoSLwA9kUAGzXHOc8JX7VgSDgcaEwDv+65CSKYkrO31WxeFmi1M0
GkvTo+XRwx+YGSORUoQAsD7BDgukMuCCeniDc2xCga+IyfspknBO5ZOJAoGAELjt
Z5peH+6icj4g1PMs5gj7BVOXDIq8rGGXjBfA2GnXAFlBqS5iJ87Oh41MIySQt1ZC
rXPn6FiJfLQ7QvyHd5Ke1BS2epB5By82Sf8PboSC/Ml3pUQ+0Jz5xbVU+gNUdEzp
FVCW+EMwtPXVdkicgzyu3bWSb7ertLhpQ7aNCQ0CgYEAgNl7rHC669PdN7YXwk9j
vSKN47BR0o4xNSxThS0ZUxquuTmWTcy2HdtxJPRi2UvDn2ELQHtfumkDEb04jeb4
iSBMCnU3OWBKmDk69rcEcgL15WTdXK0HeuwoUMlU9aNWuoAeOE53oHdUY75yvOKj
BhqEoYqwthhSM7yhbO6y/0U=
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUd0fLP0hy1m+7/O87QZuvcKAFr8QwDQYJKoZIhvcNAQEL
BQAwFTETMBEGA1UEAwwKVGVzdCBJZFAgYTAgFw0yNjEwMjEyMjEzNTBaGA8yMTI2
MDkyNzIyMTM1MFowFTETMBEGA1UEAwwKVGVzdCBJZFAgYTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAIxvzUpi4JznIh4OU967oS86V8hSHEqZuE/x5183
IEW631/D2vsT1CtI6+4xuhUadzN1DK0mPEomICXVhqv/V6haoxBPBftTNPg9zEiQ
GFfZvGaPX0WEknRvjRg9akIXdok/bafIoSyviJR7Bw8RDZW3Mi4WpTYVV3eqce7t
Y391qtEVyx+86xTaHJpa5Alyft4Phg271dmOM5yMj57+79hX5cycrE1+USyhyolf
+UhIGo8KIaIj5xMpj7k7rBZrqZTwEYrRlldBvqjBWPiN/2HVaR9T+bqYpxm6bV/Q
va8GVAu74+9NvAf3bvc0uKHPu+tmx4ZSp1gLhIbDTKQCrXcCAwEAAaNTMFEwHQYD
VR0OBBYEFP+a+/FSx55jjX66ms9OE+FBZZjRMB8GA1UdIwQYMBaAFP+a+/FSx55j
jX66ms9OE+FBZZjRMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AAT94wT/T1SKpqZgFzf43hMWtrgCQtEn+OOsarKouZbogc1+ZRWkF6RPyCxyQJnF
nvPj3WZdksof4GBO/mPkLn+9YAw0voUQtMYsIW4pIzqW2QokNly5OwkaEbgC84fO
guqRliKHbMtte33PlZL/RQEJdmrtZhVKWi7zh0Fry3of0WrHng9ZM5x/NibBZz9c
mJfdjLRznkmp4ptadqbXQWtfydhdafLKwfrS4IYLkJtA5QD8/qIOQWTNzozYoShp
/D+sEyz/s7vHLuJ7ycv9w5gyE53qnXPXzRm2ng2XUmfBk7U4kcalbxBupGVhtzqS
CIEXHqaTRFfqDypWS35p1h8=
-----END CERTIFICATE-----`,
};

/** A second IdP, for "signed by the wrong certificate". */
export const OTHER_IDP = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD1T4kOoSIlBRZU
eTJdM5vHTkoY3k8lsrORcZBNj203Rcx3WL1gchJvYWSjdsFIskA9dZLRdM6jLCFf
QPIKsFejfdfbklJxO2rGPmMPl7XX00JFBpY2RRMCXPYwVP/ZxmFsiQ5+3c00FeLq
reJJHE8XJ2AvR7UoqSEw0MSFUJ+gzU7nSedX/sMLLJTlvBDD+9GsrGyJgXhKFZmS
mKNm7iUiGv/Jt08FS6NESfkIKMXGstHaruwIwKwaZjtmNkaQBEavwlwv873llPR2
bHVFvvoj8u2HmsKV1rd/hvJWbcMWuTHPSMchch1yvjp6I9JZ495DH2X1PegvQteJ
gp5Qw8KZAgMBAAECggEAGpkvITjzfNQaYbpqbZSk9W1Vt3CTYGEJ+2E25lIA45db
3izvC8ASo6UJxnef6YP6Vy+iZbemmCa2z585H1OTjRSeDR7GdaSdpTUqhIxMmUQ8
0UMvkl7W+tCdmQv+Wdyav6v0uGjQUS92VT/ZY1gAc2A/m6DI0cnU4XghdtsRE9w4
sMJK9gtKko2+dtI9E7eg1U5ttvw41GvTFQ3jJHaWQepL4N86CO5+nwR6JMuUoM8A
2fQMCvg4umJ5PuleZBt71u2syaVUslV9Z788MerwVA7W1JncKDo1qLKig8h/E12N
yJeQwgSrDgAw7fOnVrDslxd54FSUManq0YvWcrpJoQKBgQD/7hOXRHh8NgBhwzRV
kqNzK4o1WQ820arHwGnEN8pBUbsawLmXXEcgou0AYgFpgNUhZ3naZXQVlTF85qST
XeR35uFfT4ST3uD9ZrTxR3I72h5LKIsa4fwmOx4vb+HTqUfT3VjsPHRqPvzmpM7N
tjjp70d9OTJhiXKKdLwn8iVgLQKBgQD1YLcUVUx4DLaTFmZybAq/4oCRDxavQQ7T
zouq3KaQ3UB8zl+H9MwJrEaFduXQaAgj16/q1l/WMTjvu1mYxYv1mxJIDRohds8Q
4ig06ThFkNTj9WiKKH4OmsnqXrFMmG9hU4S8yrZ5ZH1G7lAk5/aieeJk0JA5+dJx
/bHthdxDnQKBgEVf3tWhTNu2s7HMfVI49q+QfN1rL9GXUijlgoYa7Wt5YTOmTGi4
Ldut7nqtFl7n+l4cs4489BOppomJ59C+oeDSqALzBigjQW/POHsy98c7n/yVl+eI
nJYsbklDlb6PY5YNqT4YQSJPwrQutpRSsejP4NwT9hE0deUMMbjOTc1dAoGAMRL1
qpBgqcXJIeOh+5JWGAhBtEEzRTuaroupbTOR8Hj/c7aGbpdr0ydsNzcPQT39GsYB
PdM/+YOAoplyktY3Zphr8JMGPdkYEoVYizR1d5w+p5SmIrN0epFEfqYPiYUXCXz9
mBBmrCKH147D4o2tytLbj1QS9DVdfETDuABEjBUCgYEA44K4Ry7Y2PLffK4SOEEN
HnNftSx0mu3t7Tobk+SpzXYGpyqrbKttkFxyjyYs+vJnYYmG31thzmGAH9GT3aM8
4V4E3YKbBTu0XOI3QxTde/FZN3TJoKa0jeOyUmMwBzHeKXbyxOArN+nKYQB4qhh0
u3YcC37vyZ94XIRnGJuXpCo=
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUWjT60NuGrQhaXOue9Qd2nR0SVeowDQYJKoZIhvcNAQEL
BQAwFTETMBEGA1UEAwwKVGVzdCBJZFAgYjAgFw0yNjEwMjEyMjEzNTBaGA8yMTI2
MDkyNzIyMTM1MFowFTETMBEGA1UEAwwKVGVzdCBJZFAgYjCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAPVPiQ6hIiUFFlR5Ml0zm8dOShjeTyWys5FxkE2P
bTdFzHdYvWByEm9hZKN2wUiyQD11ktF0zqMsIV9A8gqwV6N919uSUnE7asY+Yw+X
tdfTQkUGljZFEwJc9jBU/9nGYWyJDn7dzTQV4uqt4kkcTxcnYC9HtSipITDQxIVQ
n6DNTudJ51f+wwsslOW8EMP70aysbImBeEoVmZKYo2buJSIa/8m3TwVLo0RJ+Qgo
xcay0dqu7AjArBpmO2Y2RpAERq/CXC/zveWU9HZsdUW++iPy7YeawpXWt3+G8lZt
wxa5Mc9IxyFyHXK+Onoj0lnj3kMfZfU96C9C14mCnlDDwpkCAwEAAaNTMFEwHQYD
VR0OBBYEFI3mxWW3xw/7YCn+4RzjyLJcohQbMB8GA1UdIwQYMBaAFI3mxWW3xw/7
YCn+4RzjyLJcohQbMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AAj9HPVuepIePKW2ErAehxP7g/+RVgTAYSGYvcbPaYmf3cMem2E9yWDU3VUB2SoG
WtDk5LlUu3AG6UWKOuwWAGn7zNIjXH3X+4zJqYpYsq5iY9e8tIL80npWxvB83zQN
X34a59O6ml2R99n2+fLoyZBBQq7zE0JaOZMD35EuGSPIeZdJtSl+jn/R3MoIhuLC
/CjM78yXKgaDsG4wWFeYtasinku0IMIEQlr/T1Tvx+f9YwJjDgOL2rwcy7gSg91m
AUpxLkCBSGCFYlKA6RTglq+3JU6pN/nnnzfKEIPdhHGSXn9eLmMFua1KcJ6ZMyLb
eJtat9JC9YCNCPhm7L7F5as=
-----END CERTIFICATE-----`,
};

export interface SamlResponseInput {
  issuer: string;
  audience: string;
  acsUrl: string;
  inResponseTo?: string;
  nameId: string;
  nameIdFormat?: string;
  attributes?: Record<string, string>;
  /** Defaults to now. */
  now?: Date;
  /** Assertion lifetime; default 5 minutes. */
  validForMs?: number;
  /** Signing key; default TEST_IDP. Null: unsigned. */
  signer?: { key: string; cert: string } | null;
}

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A base64 SAMLResponse with a signed assertion. */
export function buildSamlResponse(input: SamlResponseInput): string {
  const now = input.now ?? new Date();
  const notBefore = new Date(now.getTime() - 1000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + (input.validForMs ?? 5 * 60_000)).toISOString();
  const issued = now.toISOString();
  const irt = input.inResponseTo ? ` InResponseTo="${esc(input.inResponseTo)}"` : '';
  const attrs = Object.entries(input.attributes ?? {})
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${esc(name)}"><saml:AttributeValue>${esc(value)}</saml:AttributeValue></saml:Attribute>`,
    )
    .join('');
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${issued}">` +
    `<saml:Issuer>${esc(input.issuer)}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="${input.nameIdFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'}">${esc(input.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${irt} NotOnOrAfter="${notOnOrAfter}" Recipient="${esc(input.acsUrl)}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${esc(input.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issued}" SessionIndex="_s${randomUUID()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attrs ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>`;
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${issued}" Destination="${esc(input.acsUrl)}"${irt}>` +
    `<saml:Issuer>${esc(input.issuer)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`;
  const signer = input.signer === undefined ? TEST_IDP : input.signer;
  if (signer) {
    xml = signSamlPost(xml, "//*[local-name(.)='Assertion']", {
      privateKey: signer.key,
      publicCert: signer.cert,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
  }
  return Buffer.from(xml).toString('base64');
}
