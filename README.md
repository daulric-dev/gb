# GradeBook (gb)

A school management platform for educators to manage academic records, student enrollment, grading, and class administration. Built by [daulric](https://daulric.dev).

GradeBook is not affiliated with any specific school - any educator can sign up, create a school, and start managing their classes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Preact Signals, @react-pdf/renderer |
| **Backend** | NestJS 11, Fastify, Swagger |
| **Caching** | Pluggable - in-memory (default) or Redis via ioredis |
| **Database** | Supabase (PostgreSQL) with Row-Level Security |
| **Auth** | Passwordless OTP via email |
| **Monorepo** | Turborepo |
| **Runtime** | Bun |
| **CI/CD** | GitHub Actions (with CI Gate required status check) |

## Project Structure

```
gbv2/
├── backend/               # NestJS API server
│   └── src/
│       ├── academic-year/
│       ├── auth/          # OTP auth, guards, profile management
│       ├── calculation/   # Grade calculations (term & year)
│       ├── class/         # Class & teacher management
│       ├── enrollment/    # Student enrollment & subject assignment
│       ├── grading/       # Assessments & grade entry
│       ├── school/
│       ├── student/
│       ├── subject/
│       ├── supabase/      # Supabase client service
│       ├── cache/         # Pluggable caching (memory / Redis)
│       ├── images/        # Image upload service (avatar, resumable TUS uploads)
│       └── term/
├── frontend/              # Next.js app
│   └── app/
│       ├── dashboard/     # Main app (classes, students, grading, settings)
│       ├── login/         # OTP login flow
│       ├── onboard/       # First-time setup
│       ├── privacy/       # Privacy policy
│       └── terms/         # Terms of service
│   └── lib/reports/       # PDF, CSV, XLSX report generation
├── command/               # gb CLI tool
│   ├── index.ts           # Entrypoint
│   ├── commands.ts        # Command implementations
│   ├── constants.ts       # Services, commit types, config
│   ├── prompts.ts         # Interactive terminal prompts
│   ├── utils.ts           # Git helpers, arg parsing
│   ├── timer.ts           # Execution timer
│   └── help.json          # Help text data
├── docs/                  # Project documentation
├── .github/workflows/     # CI, coverage, security scanning
└── .github/scripts/       # Discord notify, workflow status checker
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- A [Supabase](https://supabase.com) project

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

**Backend** - create `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PUSHABLE_KEY=your-anon-key
FRONTEND_URL=http://localhost:3000
PORT=3001
```

**Frontend** - create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

See [`docs/environment-variables.md`](docs/environment-variables.md) for full details on every variable.

### 3. Run the dev servers

```bash
bun run dev
```

This starts both the frontend (port 3000) and backend (port 3001) in parallel via Turborepo.

### Individual servers

```bash
bun run dev:frontend   # Next.js on :3000
bun run dev:backend    # NestJS on :3001
```

### Build

```bash
bun run build            # Build both frontend and backend (cached)
bun run build:frontend   # Build frontend only
bun run build:backend    # Build backend only
```

## Features

- **Passwordless authentication** - sign in via email OTP, no passwords stored
- **School management** - create and manage schools independently
- **Class management** - create classes, assign class teachers and subject teachers
- **Student enrollment** - enroll students, assign subjects per student
- **Grading system** - create assessments, enter grades, exclude/include students
- **Grade calculations** - automatic term and year result computation with configurable weighting
- **Role-based access control** - admins, class teachers, and subject teachers each see only what they should
- **Settings** - update profile, change school, upload profile picture with image cropping, delete account (GDPR)
- **PDF report cards** - student report cards and class exam broadsheets via `@react-pdf/renderer`, matching physical school forms
- **Haptic feedback** - global haptic feedback on all interactive elements via `web-haptics` (mobile devices)
- **Dark mode** - system-aware theme switching

## API Documentation

When the backend is running, Swagger docs are available at:

```
http://localhost:3001/docs
```

## CLI (`gb`)

The project includes a monorepo-aware Git CLI at `command/index.ts`. It scopes git operations to individual services so you don't accidentally commit cross-service changes.

```bash
bun link        # registers "gbsh" globally
bun run gb <command>
```

| Command | Description |
|---------|-------------|
| `gb status` | Show git status grouped by service |
| `gb affected` | List services with changes vs a base branch |
| `gb branch` | Create a service-scoped branch |
| `gb commit` | Stage and commit (multi-service loop) |
| `gb diff` | Show diff for a service or all |
| `gb push` | Push current branch to origin |
| `gb pr` | Create a pull request via GitHub, GitLab, or Bitbucket API |
| `gb run` | Run a package.json script in a service |

**Full documentation:** [`docs/cli/`](docs/cli/overview.md) — architecture, interactive prompts, and detailed command reference.

## Scripts

All tasks are orchestrated by [Turborepo](https://turbo.build) for caching and parallel execution.

| Command | Description |
|---------|-------------|
| `bun run dev` | Start both servers in development (parallel) |
| `bun run dev:frontend` | Start frontend only |
| `bun run dev:backend` | Start backend only |
| `bun run build` | Build both projects (cached) |
| `bun run build:frontend` | Build frontend only |
| `bun run build:backend` | Build backend only |
| `bun run lint` | Lint both projects (parallel) |
| `bun run test` | Run all tests (parallel) |
| `bun run test:frontend` | Run frontend tests only |
| `bun run test:backend` | Run backend tests only |
| `bun run preview` | Build and run both in production mode |
| `bun run db:types` | Generate Supabase database types |

You can also use `turbo` directly for more control:

```bash
turbo run build --filter=frontend    # build a specific package
turbo run lint test --parallel       # run multiple tasks
turbo run build --dry-run            # see what would run
```

## Contributing

GradeBook is **source-available** - the code is public to encourage security review and bug discovery. If you find a vulnerability or bug, please report it to **security@daulric.dev**. Do not open a public issue for security findings.

See [SECURITY.md](SECURITY.md) for full details on scope, expectations, and what to include in a report.

## License

Source-available, proprietary - see [LICENSE.md](LICENSE.md) for details. You may view and review the code, but use, modification, and redistribution are not permitted without authorization.
