---
sidebar_label: Dedicated Deployment
---

# Dedicated Deployment

A dedicated deployment is a single-school instance of GradeBook hosted on its own infrastructure. The school gets its own Postgres database, S3 bucket and backend/frontend deployment.

This is distinct from the default multi-tenant setup where multiple schools share one platform.

---

## How It Works

When `DEDICATED_DEPLOYMENT=true` is set on the backend:

- **School creation is limited to one.** The first school can be created during onboarding. Any subsequent attempt to create a school returns `403 Forbidden`.
- **Onboarding targets the single existing school.** New staff submit a join request requiring administrator approval, and students join using the school join code - no dropdown or manual school picker needed.
- **School switching is hidden** in the frontend sidebar.

The schema, RLS policies, and all API behaviour remain identical to the multi-tenant setup. The only difference is the enforcement of the one-school limit and the simplified onboarding flow.

---

## Setup

### 1. Provision the services

- **PostgreSQL 15+** - any managed Postgres, or the commented-out `db` service in `infrastructure/docker-compose.yml` for a single box
- **S3-compatible storage** - AWS S3, Cloudflare R2, Backblaze B2, MinIO, SeaweedFS... one bucket, with the CORS rule from [Platform migration](./platform-migration.md#bucket-cors-production)
- **SMTP** - any provider, for sign-in codes
- **Backups** - a separate S3 bucket and an age key pair for the `backup` service in `infrastructure/docker-compose.yml` (daily encrypted dump at 04:00), plus point-in-time recovery at your Postgres provider or the WAL-G `db` image. Required in production; see [Backups & GDPR](./backups.md)

### 2. Run Migrations

The backend image applies pending migrations when it starts. To run them yourself:

```bash
cd backend
DATABASE_URL=postgresql://... bun run db:deploy   # prisma migrate deploy
```

### 3. Configure Backend

**`backend/.env`**

```env
DATABASE_URL=postgresql://gradebook:...@db-host:5432/gradebook
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=gradebook
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
SMTP_URL=smtps://user:pass@smtp.example.com:465
MAIL_FROM="GradeBook <no-reply@your-school.edu>"
AUTH_SECRET=...                 # openssl rand -base64 32
CHAT_ENCRYPTION_KEY=...         # openssl rand -base64 32
STUDENT_CLAIM_CODE_PEPPER=...   # openssl rand -base64 32
API_URL=https://your-backend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
DEDICATED_DEPLOYMENT=true
```

### 4. Configure Frontend

**`frontend/.env.local`**

```env
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_DEDICATED_DEPLOYMENT=true
```

### 5. First Login - Create the School

On the very first login, the onboarding form will include a **Create school** option (since no school exists yet). Create the school during this step - this is the only time school creation is permitted.

All subsequent staff who register will automatically submit a join request to this school (requiring admin approval), while students join using the school join code.

---

## Behavioural Differences vs Multi-Tenant

| Feature | Multi-Tenant | Dedicated |
|---------|-------------|-----------|
| School creation | Unlimited | One-time only (first onboard) |
| Onboarding school selector | Shown | Hidden |
| School switcher in sidebar | Shown | Hidden |
| Access rules (API) | Same | Same |
| API endpoints | Same | Same |
| Database and storage | Shared | Dedicated |

---

## Security Notes

- `DEDICATED_DEPLOYMENT=true` is enforced **server-side** - even if a client sends a request to `POST /schools`, it will be rejected once a school exists.
- All existing RLS policies apply as normal. Since the entire database belongs to one school, `get_user_school_id()` will always resolve to the same school for every user.
- `NEXT_PUBLIC_DEDICATED_DEPLOYMENT` only controls UI visibility. The backend enforcement does not depend on this frontend variable.
