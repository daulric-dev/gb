# Security Policy

GradeBook's source code is publicly available to encourage community-driven security review. We welcome security researchers and developers to inspect the codebase, identify vulnerabilities, and report them responsibly.

Please see [LICENSE.md](LICENSE.md) for what is and isn't permitted - the code is source-available for review and bug reporting only, not for use or redistribution.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability or bug in GradeBook, please report it responsibly.

**Do not open a public issue.** Instead, please email the GradeBook team directly:

- Email: **security@daulric.dev**

### What to include

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fix (optional)

### What to expect

- We will acknowledge your report within **48 hours**
- We will investigate and provide an initial assessment within **7 days**
- We will work on a fix and coordinate disclosure with you
- We will credit you in the fix (unless you prefer to remain anonymous)

## Security Measures

GradeBook implements application-level security controls. The deployment owner
is responsible for the underlying hosts, database, object storage, network and
operational procedures. Do not treat this list as a certification or as a
substitute for a deployment-specific security review.

- **Passwordless authentication** via email one-time codes; optional TOTP
  multi-factor authentication with recovery codes, and configurable MFA
  requirements for privileged users
- **Session controls** with revocation, configurable inactivity and absolute
  limits, and optional new-sign-in alerts
- **Server-side authorization** with roles, permissions, and scoped access
  checks on API requests. PostgreSQL row-level security is not implemented;
  database access isolation is enforced by the application.
- **Encryption in transit** when the deployment is correctly configured to use
  HTTPS. Configure TLS at the application ingress or reverse proxy.
- **Field-level encryption** for selected sensitive values (including chat
  content, pastoral notes, accommodation reasons and stored secrets). This is
  not blanket database encryption at rest. Configure disk/database encryption
  with the hosting provider and encrypt backups separately.
- **Audit logging** for security-sensitive and school-record actions. The
  daily retention job purges school-record, SSO and integration audit entries
  after two years by default (`AUDIT_LOG_RETENTION_DAYS`); keep the job enabled
  and set a deployment-specific period where required.
- **Input validation** on API endpoints and rate limits on selected
  authentication and sensitive operations
- **CORS restrictions** based on configured origins
- **Dependency scanning** in the repository's CI workflows

These controls depend on correct configuration and operation. In particular,
GradeBook cannot enforce the host's disk encryption, database access policy,
backup protection, patching, monitoring, or incident response.

Deployment owners should maintain a response process and breach register. A
starter checklist is in the [GDPR preparation guide](docs/content/gdpr/index.md).

## Scope

The following are in scope for security reports:

- Authentication and session management
- Authorization and access control bypass
- Data exposure across schools, classes, or roles
- API vulnerabilities (injection, SSRF, etc.)
- Dependency vulnerabilities

The following are **out of scope**:

- Social engineering attacks
- Denial-of-service attacks against infrastructure providers
- Issues in third-party services (Vercel, your database, storage or email provider, etc.) - please report those to the respective providers
