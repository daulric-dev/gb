---
sidebar_label: Supabase Edge Functions
sidebar_position: 4
---

# Supabase Edge Functions

GradeBook uses Supabase Edge Functions for short-lived, data-processing workloads. The functions live in `supabase/functions/` and are deployed with the Supabase GitHub integration or the Supabase CLI.

## Current Functions

| Function               | Purpose                                                        | Caller                      |
| ---------------------- | -------------------------------------------------------------- | --------------------------- |
| `report-class-summary` | Builds class report summaries and subject statistics           | Backend service client      |
| `attendance-summary`   | Aggregates class attendance totals and per-student rates       | Backend service client      |
| `dashboard-summary`    | Aggregates school dashboard metrics in one request             | Backend service client      |
| `grade-analytics`      | Calculates grade distributions and subject statistics          | Backend service client      |
| `large-report-export`  | Streams a large class report as CSV                            | Direct authenticated caller |
| `announcement-feed`    | Paginates announcements close to the database                  | Direct authenticated caller |
| `notification-summary` | Combines unread notification totals                            | Direct authenticated caller |
| `bulk-import-preview`  | Validates CSV rows without writing imported data               | Direct authenticated caller |
| `file-share-notify`    | Resolves file-share recipients and writes in-app notifications | BullMQ queue handler        |
| `file-ingest`          | Registers generated files and creates system folders           | BullMQ queue handler        |

## Additional Candidates

These features can also benefit from Edge Functions without custom secrets:

| Candidate                                                                                                   | Benefit |
| ----------------------------------------------------------------------------------------------------------- | ------- |
| The listed candidates are now implemented. Future candidates should follow the same JWT and RLS-only model. |

Prefer Postgres functions for pure SQL aggregation, BullMQ for long-running or retry-heavy work, and NestJS for Node-specific PDF/XLSX generation or ClamAV scanning.

## Deployment Boundaries

The Supabase GitHub integration deploys database migrations and the functions under `supabase/functions/`. It does not deploy the NestJS code under `backend/` or the frontend.

The backend changes that invoke these functions must be deployed through the normal backend pipeline. A function deployment without its compatible backend deployment can leave a caller pointing at an unavailable function, so deploy them together when changing a function contract.

## Credentials

These functions do not contain or require application secrets. They use the public `SUPABASE_URL` and `SUPABASE_ANON_KEY` together with the caller's `Authorization: Bearer <jwt>` header. Supabase RLS remains responsible for row-level access.

The backend may invoke the functions with its service-role client, but that secret stays in the backend environment and is never read by or stored in function source code.

## Authentication Model

Each function requires a bearer token. Direct callers use a user access token; backend queue callers use the backend client's authorization header. The function forwards that header to Supabase so queries run in the caller's security context.

The backend route and queue still enforce application-level authorization before invoking a function. Service-role authentication is not a replacement for class, school, or ownership checks in NestJS.

## Deploying

Link the local repository to the project once:

```bash
supabase link --project-ref <project-ref>
```

Deploy functions individually:

```bash
supabase functions deploy report-class-summary
supabase functions deploy attendance-summary
supabase functions deploy dashboard-summary
supabase functions deploy grade-analytics
supabase functions deploy large-report-export
supabase functions deploy announcement-feed
supabase functions deploy notification-summary
supabase functions deploy bulk-import-preview
supabase functions deploy file-share-notify
supabase functions deploy file-ingest
```

The GitHub integration should run the equivalent deploy commands for every changed function. Store its deployment credentials, such as `SUPABASE_ACCESS_TOKEN` and the project reference, as GitHub Actions secrets. Do not use the service-role key as a GitHub deployment credential.

## Local Testing

Start a local Supabase stack, set local function secrets, and serve a function:

```bash
supabase start
supabase secrets set --env-file supabase/.env.local
supabase functions serve report-class-summary --no-verify-jwt
```

`--no-verify-jwt` is convenient for local development only. Production functions should retain gateway JWT verification. The functions still require an `Authorization` header in their own handlers.

## Design Rules

Use an Edge Function for short request/response work over large datasets when the caller's JWT and RLS are sufficient. Keep provider integrations that require secrets, long-running jobs in BullMQ, Node-specific PDF/XLSX generation in NestJS, and pure aggregation in Postgres functions when SQL is the simpler boundary.

Do not put secrets in function source files, `NEXT_PUBLIC_*` variables, migration files, or committed `.env` files.
