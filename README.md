# GradeBook

A school management platform for educators to manage academic records, student enrollment, grading, and class administration. Built by [daulric](https://daulric.dev).

GradeBook is not affiliated with any specific school - any educator can sign up, create a school, and start managing their classes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Preact Signals |
| **Backend** | NestJS 11, Fastify, Swagger |
| **Caching** | Pluggable - in-memory (default) or Redis via ioredis |
| **Database** | Supabase (PostgreSQL) with Row-Level Security |
| **Auth** | Passwordless OTP via email |
| **Runtime** | Bun |
| **CI/CD** | GitHub Actions |

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
│       └── term/
├── frontend/              # Next.js app
│   └── app/
│       ├── dashboard/     # Main app (classes, students, grading, settings)
│       ├── login/         # OTP login flow
│       ├── onboard/       # First-time setup
│       ├── privacy/       # Privacy policy
│       └── terms/         # Terms of service
├── command/               # gb CLI tool
├── docs/                  # Project documentation
└── .github/workflows/     # CI, coverage, security scanning
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

This starts both the frontend (port 3000) and backend (port 3001) concurrently.

### Individual servers

```bash
bun run dev:frontend   # Next.js on :3000
bun run dev:backend    # NestJS on :3001
```

### Build

```bash
bun run build:all      # Build both frontend and backend
bun run preview        # Build and run production locally
```

## Features

- **Passwordless authentication** - sign in via email OTP, no passwords stored
- **School management** - create and manage schools independently
- **Class management** - create classes, assign class teachers and subject teachers
- **Student enrollment** - enroll students, assign subjects per student
- **Grading system** - create assessments, enter grades, exclude/include students
- **Grade calculations** - automatic term and year result computation with configurable weighting
- **Role-based access control** - admins, class teachers, and subject teachers each see only what they should
- **Settings** - update profile, change school, delete account (GDPR)
- **Dark mode** - system-aware theme switching

## API Documentation

When the backend is running, Swagger docs are available at:

```
http://localhost:3001/docs
```

## CLI (`gb`)

The project includes a monorepo-aware Git CLI at `command/index.ts`. It scopes git operations to individual services so you don't accidentally commit cross-service changes.

### Setup

```bash
bun link        # registers the "gbsh" command globally
```

Or run directly:

```bash
bun run gb <command>
```

### Commands

| Command | Description |
|---------|-------------|
| `gb status` | Show `git status` grouped by service |
| `gb affected [--base=main]` | List services with changes vs a base branch |
| `gb commit [service]` | Stage and commit files for a service |
| `gb diff [service]` | Show diff for a specific service or all |
| `gb run <service> <script>` | Run a package.json script in a service directory |
| `gb help` | Show help |

### `gb commit`

Interactive commit flow scoped to a single service.

```bash
gb commit                   # prompted to select a service
gb commit frontend          # skip service selection
gb commit frontend --topic "add auth" --type=feat
gb commit backend --topic "fix query" -m "handle null joins" --type=fix
```

**Options:**

- `--topic "..."` — commit subject (required, prompted if omitted, max 10 words)
- `-m "..."` — optional extended commit body
- `--type=<type>` — commit type prefix (default: `feat`). One of: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`

When no service is provided, an interactive arrow-key selector is shown. When `--topic` is omitted, you're prompted with a live word counter (limit: 10 words).

If you're on a protected branch (`main`/`master`), a new branch is auto-created (e.g. `frontend/feat/add-auth`) before committing.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start both servers in development |
| `bun run dev:frontend` | Start frontend only |
| `bun run dev:backend` | Start backend only |
| `bun run build:all` | Build both projects |
| `bun run preview` | Build and run production |
| `bun run lint` | Lint both projects |
| `bun run db:types` | Generate Supabase database types |

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## License

Proprietary - see [LICENSE.md](LICENSE.md) for details.
