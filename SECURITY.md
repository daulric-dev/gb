# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in GradeBook, please report it responsibly.

**Do not open a public issue.** Instead, please reach out directly to the GradeBook team:

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

GradeBook implements the following security practices:

- **Passwordless authentication** via email OTP - no passwords are stored
- **TLS encryption** for all data in transit
- **Encryption at rest** for all database storage
- **Row-Level Security (RLS)** policies enforcing data isolation between schools and classes
- **Role-based access control** with server-side guards on every API endpoint
- **Short-lived access tokens** with automatic refresh and session invalidation on logout
- **Rate limiting** on all endpoints to prevent brute-force and denial-of-service attacks
- **CORS policies** restricting API access to authorized origins
- **Automated dependency scanning** for known vulnerabilities via OSV-Scanner
- **Input validation** on all API endpoints using class-validator

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
- Issues in third-party services (Supabase, Vercel, etc.) - please report those to the respective providers
