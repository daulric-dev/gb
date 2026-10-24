# Email domain DTOs (`src/email-domain/dto`)

Request bodies for the school admin's email-domain routes, all in `email-domain.dto.ts` and validated by the global `ValidationPipe`. Deeper checks (domain normalization, free-mail refusal, SSO provider availability, tenant GUID, https URL, X.509 certificate, SSO prerequisites) happen in `EmailDomainService`.

## Classes

| Class | Route | Rules |
|-------|-------|-------|
| `AddEmailDomainDto` | `POST /api/schools/email-domains` | `domain`: required string, max 253. `audience`: `student`, `staff` or `any`. `autoJoin`: optional boolean (staff domains: join outright or file a join request). `staffRole`: optional `teacher` or `member`. |
| `UpdateEmailDomainDto` | `PATCH /api/schools/email-domains/:id` | All optional. `ssoProvider`: adapter id from `GET /auth/sso/providers`, max 32, `null` turns SSO off. `ssoRequired`: boolean. `azureTenantId`: max 64, nullable. `samlEntryPoint`: max 2048, nullable. `samlIssuer`: max 1024, nullable. `samlCertificate`: PEM or base64, max 16384, nullable. `audience`, `autoJoin`, `staffRole` as in `AddEmailDomainDto`. |

The join routes (`/api/auth/email-domain/match` and `/join`) take no body: they use the session's email.

## Adding a field

Add it to the DTO with `class-validator` and Swagger decorators, then map it in `EmailDomainService.update` (or `add`), add the column to `DOMAIN_SELECT` and the response mapping, and add a column to `school_email_domain` in `prisma/schema/school.prisma` if needed.

See the [email-domain README](../README.md).
