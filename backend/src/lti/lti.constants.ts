import { configuredApiUrl } from '@/config/origins';

/** LTI 1.3 / LTI Advantage claim names. */
export const CLAIM = {
  messageType: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  version: 'https://purl.imsglobal.org/spec/lti/claim/version',
  deploymentId: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  targetLinkUri: 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  resourceLink: 'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  roles: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  context: 'https://purl.imsglobal.org/spec/lti/claim/context',
  toolPlatform: 'https://purl.imsglobal.org/spec/lti/claim/tool_platform',
  launchPresentation: 'https://purl.imsglobal.org/spec/lti/claim/launch_presentation',
  custom: 'https://purl.imsglobal.org/spec/lti/claim/custom',
  agsEndpoint: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
} as const;

export const ROLE = {
  instructor: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
  teachingAssistant: 'http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant',
  learner: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
  administrator: 'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator',
} as const;

export const COURSE_OFFERING = 'http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering';

/** AGS scopes a tool may be granted. */
export const SCOPE = {
  lineItem: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
  lineItemReadonly: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
  score: 'https://purl.imsglobal.org/spec/lti-ags/scope/score',
  resultReadonly: 'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
} as const;
export const AGS_SCOPES: readonly string[] = Object.values(SCOPE);

export const MEDIA = {
  lineItem: 'application/vnd.ims.lis.v2.lineitem+json',
  lineItemContainer: 'application/vnd.ims.lis.v2.lineitemcontainer+json',
  score: 'application/vnd.ims.lis.v1.score+json',
  resultContainer: 'application/vnd.ims.lis.v2.resultcontainer+json',
} as const;

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** A launch ticket (lti_message_hint) is good for this long, once. */
export const LAUNCH_TTL_SECONDS = 5 * 60;
/** id_token lifetime. */
export const ID_TOKEN_TTL_SECONDS = 5 * 60;
/** AGS access token lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Longest a client assertion may live (exp - now). */
export const MAX_ASSERTION_LIFETIME_SECONDS = 10 * 60;
/** Clock skew allowed on iat / exp. */
export const CLOCK_SKEW_SECONDS = 60;
/** Retired platform keys stay in the JWKS this long. */
export const RETIRED_KEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tool JWKS cache. */
export const TOOL_JWKS_TTL_MS = 5 * 60 * 1000;
/** Requests per tool per minute on the token and AGS endpoints. */
export const DEFAULT_TOOL_RATE_LIMIT = 300;

/** Paths the CSRF hook and body parsers single out (see common/csrf.ts). */
export const LTI_AUTH_PATH = '/api/lti/auth';
export const LTI_TOKEN_PATH = '/api/lti/token';
export const LTI_AGS_PREFIX = '/api/lti/ags/';

/** The platform's issuer: API_URL (required in production). */
export function platformIssuer(): string {
  return configuredApiUrl() ?? `http://localhost:${process.env.PORT ?? 3001}`;
}

export function platformEndpoints() {
  const issuer = platformIssuer();
  return {
    issuer,
    authUrl: `${issuer}${LTI_AUTH_PATH}`,
    jwksUrl: `${issuer}/api/lti/jwks`,
    tokenUrl: `${issuer}${LTI_TOKEN_PATH}`,
  };
}

export function lineItemsUrl(courseId: string): string {
  return `${platformIssuer()}${LTI_AGS_PREFIX}courses/${courseId}/lineitems`;
}

export function lineItemUrl(courseId: string, lineItemId: string): string {
  return `${lineItemsUrl(courseId)}/${lineItemId}`;
}

export function toolRateLimit(): number {
  const n = Number(process.env.LTI_TOOL_RATE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TOOL_RATE_LIMIT;
}
