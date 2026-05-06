---
sidebar_label: Dedicated Deployment
---

# Dedicated Deployment

A dedicated deployment is a single-school instance of GradeBook hosted on its own infrastructure. The school gets their own Supabase instance (self-hosted or Supabase-managed) and their own backend/frontend deployment.

This is distinct from the default multi-tenant setup where multiple schools share one platform.

---

## How It Works

When `DEDICATED_DEPLOYMENT=true` is set on the backend:

- **School creation is limited to one.** The first school can be created during onboarding. Any subsequent attempt to create a school returns `403 Forbidden`.
- **Onboarding skips school selection.** New users are automatically assigned to the single existing school - no dropdown, no school picker.
- **School switching is hidden** in the frontend sidebar.

The schema, RLS policies, and all API behaviour remain identical to the multi-tenant setup. The only difference is the enforcement of the one-school limit and the simplified onboarding flow.

---

## Setup

### 1. Provision a Supabase Instance

Use either:
- **Supabase Cloud** - create a new project at [supabase.com](https://supabase.com)
- **Self-hosted Supabase** - follow the [official self-hosting guide](https://supabase.com/docs/guides/self-hosting)

### 2. Run Migrations

Pull the schema from the reference project or apply your migration file:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 3. Configure Backend

**`backend/.env`**

```env
SUPABASE_URL=https://your-instance.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PUSHABLE_KEY=your-anon-key
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

All subsequent users who log in will be automatically assigned to this school, with no school selection shown.

---

## Behavioural Differences vs Multi-Tenant

| Feature | Multi-Tenant | Dedicated |
|---------|-------------|-----------|
| School creation | Unlimited | One-time only (first onboard) |
| Onboarding school selector | Shown | Hidden |
| School switcher in sidebar | Shown | Hidden |
| RLS policies | Same | Same |
| API endpoints | Same | Same |
| Supabase instance | Shared | Dedicated |

---

## Security Notes

- `DEDICATED_DEPLOYMENT=true` is enforced **server-side** - even if a client sends a request to `POST /schools`, it will be rejected once a school exists.
- All existing RLS policies apply as normal. Since the entire database belongs to one school, `get_user_school_id()` will always resolve to the same school for every user.
- `NEXT_PUBLIC_DEDICATED_DEPLOYMENT` only controls UI visibility. The backend enforcement does not depend on this frontend variable.
