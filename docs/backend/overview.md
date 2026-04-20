# Backend Overview

The backend is a **NestJS** application running on the **Fastify** HTTP adapter. It serves as the REST API for the GradeBook application, handling authentication, school management, academic structure, student enrollment, grading, and grade calculations.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| NestJS 11 | Application framework |
| Fastify | HTTP server (replaces Express for performance) |
| Supabase | Database (PostgreSQL), authentication, and row-level security |
| TypeScript 5 | Type safety |
| Bun Test | Testing framework (built-in `bun:test`) |
| Swagger | API documentation (auto-generated at `/docs`) |
| class-validator | DTO validation |

## Project Structure

```
backend/
├── api/
│   └── index.ts               # Vercel serverless entry point
├── vercel.json                # Vercel routing and build config
├── src/
│   ├── createApp.ts           # Shared app bootstrap (used by main.ts and api/index.ts)
│   ├── main.ts                # Local dev entry point (calls createApp + listen)
│   ├── worker.ts              # Cloudflare Workers entry point
│   ├── app.module.ts          # Root module
│   ├── app.controller.ts      # Health check endpoint
│   ├── app.service.ts         # Health check service
│   ├── stubs/
│   │   └── empty.js           # Stub for optional NestJS deps during CF Workers bundling
│   ├── types/
│   │   └── database.types.ts  # Generated Supabase schema types
│   ├── supabase/              # Supabase client provider
│   ├── auth/                  # Authentication (OTP, JWT, onboarding)
│   ├── school/                # School management
│   ├── academic-year/         # Academic year lifecycle
│   ├── term/                  # Term management within years
│   ├── student/               # Student records
│   ├── subject/               # Subject definitions
│   ├── class/                 # Class (student group) management
│   ├── enrollment/            # Student enrollment and subject assignment
│   ├── grading/               # Assessments and grades
│   ├── calculation/           # Grade calculations and summaries
│   ├── reporting/             # Report generation, status workflow, file storage
│   └── cache/                 # Pluggable caching (memory or Redis)
```

## Application Bootstrap

The app bootstrap logic lives in `src/createApp.ts` and is shared between all entry points. It configures:

- **Adapter**: Fastify
- **Global prefix**: `api/v1` - all routes are prefixed with this
- **Swagger**: Available at `/docs`
- **Validation**: Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform` enabled
- **CORS**: Allows requests from `FRONTEND_URL` environment variable (defaults to `http://localhost:3000`)
- **Multipart**: `@fastify/multipart` with 10MB file size limit

`createApp()` calls `app.init()` but does **not** call `app.listen()`. Each entry point handles the serving strategy:

| Entry Point | File | Behavior |
|-------------|------|----------|
| **Local dev** | `src/main.ts` | Calls `createApp()` then `app.listen()` on `PORT` (default 3001) |
| **Vercel** | `api/index.ts` | Calls `createApp()`, caches the app instance, pipes Node.js requests through Fastify |
| **Cloudflare Workers** | `src/worker.ts` | Lazy init, transfers env to `process.env`, uses Fastify `.inject()` |

## Deployment

### Vercel (Serverless)

The backend deploys to Vercel as a single serverless function:

- `vercel.json` routes all requests (`/(.*)`) to `api/index.ts` via `@vercel/node`
- The NestJS app is created once on cold start and cached for subsequent requests
- Environment variables are configured in the Vercel dashboard

### Cloudflare Workers

- `wrangler.toml` configures the worker with `nodejs_compat` flag
- `src/worker.ts` handles the `fetch` event and uses Fastify's `.inject()` method
- Optional NestJS dependencies are stubbed via `[alias]` in `wrangler.toml`

## Root Module (`app.module.ts`)

Imports all feature modules and configures global providers:

- `ConfigModule.forRoot({ isGlobal: true })` - environment variable access
- `ThrottlerModule` - rate limiting (100 requests per 60 seconds per client)
- `APP_GUARD` → `ThrottlerGuard` - applied globally to all endpoints

### Module Dependency Tree

```
AppModule
├── ConfigModule (global)
├── ThrottlerModule (global guard)
├── SupabaseModule (global - provides DB clients)
├── AuthModule (exports AuthGuard)
├── SchoolModule
├── AcademicYearModule
├── TermModule
├── StudentModule
├── SubjectModule
├── ClassModule (exports ClassTeacherGuard)
├── EnrollmentModule (imports ClassModule for guard)
├── GradingModule
├── CalculationModule
├── ReportingModule
└── CacheModule (global - exports CacheService with memory or Redis store)
```

## Supabase Integration

The `SupabaseModule` is marked `@Global()` and provides `SupabaseService` to all modules. It offers two types of clients:

| Method | Use Case | Auth |
|--------|----------|------|
| `getServiceClient()` | Server-side operations that bypass RLS | Uses `SUPABASE_SERVICE_ROLE_KEY` |
| `createUserClient(token, schema)` | User-context operations that respect RLS | Uses the user's JWT; schema can be `public`, `student`, `grading`, `reporting`, or `staff` |

## Database Schemas

The PostgreSQL database uses multiple schemas to organize tables:

| Schema | Contains |
|--------|----------|
| `public` | `user_profile`, `school`, `academic_year`, `term`, `subject`, `student_group` |
| `student` | `student`, `student_group_enrollment`, `student_subject_profile` |
| `staff` | `teacher_group_assignment`, `teacher_subject_assignment` |
| `grading` | `assessment`, `grade` |
| `reporting` | `report_book`, `report_book_entry`, `report_book_pdf`, `class_report_file` |

## Guards

| Guard | Location | Behavior |
|-------|----------|----------|
| `ThrottlerGuard` | Global (APP_GUARD) | Rate limits all endpoints |
| `AuthGuard` | `auth/auth.guard.ts` | Validates Bearer JWT via Supabase `getUser`; populates `request.user` with `{ id, email, access_token }` |
| `ClassTeacherGuard` | `class/class-teacher.guard.ts` | Checks if the user is an admin or the class teacher for the `:classId` route parameter |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for admin operations |
| `SUPABASE_PUSHABLE_KEY` | Yes | Anon/public key for user-context clients |
| `FRONTEND_URL` | No | CORS origin (defaults to `http://localhost:3000`) |
| `PORT` | No | Server port (defaults to `3001`) |
| `USE_REDIS` | No | Set to `true` to use Redis for caching (defaults to in-memory) |
| `REDIS_URL` | Only if `USE_REDIS=true` | Redis connection URL (e.g., `redis://localhost:6379`) |

## Running the Backend

```bash
cd backend
bun install
bun run start:dev    # Development with hot-reload
bun run build        # Production build
bun run start:prod   # Production server
bun run lint         # ESLint check
bun run test         # Unit tests (Bun test runner)
```

### Deploying

```bash
# Vercel
vercel deploy              # Deploy to Vercel (uses vercel.json)

# Cloudflare Workers
bun run deploy             # Deploy via wrangler
bun run deploy:staging     # Deploy to staging environment
```
