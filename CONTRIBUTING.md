# Contributing to GradeBook

Thanks for your interest in GradeBook. Please read this before opening an issue or a pull request.

## Who can contribute what

GradeBook is **source-available, not open source**. Read the [license](LICENSE.md) first: the code is public so that people can review it and report problems, not so that they can modify, deploy or redistribute it.

| You are | You can |
| --- | --- |
| Anyone | Read the code, report bugs, and report security issues. |
| An authorised collaborator (written permission from [daulric](https://daulric.dev)) | Open branches and pull requests, following the workflow below. |

Pull requests from anyone else will be closed without review. If you would like to contribute code, ask first at [daulric.dev](https://daulric.dev).

## Reporting a security issue

**Do not open a public issue.** Email **security@daulric.dev** with what you found, how to reproduce it and its impact. See [SECURITY.md](SECURITY.md) for what to include and what to expect.

## Reporting a bug

Open a GitHub issue with:

- what you did, what you expected, and what happened instead;
- where it happened: web (`dashboard/` staff or `portal/` student), mobile (iOS or Android, app version), or API;
- steps to reproduce, and any error text or screenshots (remove personal data first);
- the commit or release you are on, if you run it yourself.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## For collaborators

### Setup

The [developer guide](docs/content/developer-guide.md) covers prerequisites, environment files and first run. In short:

```bash
bun install                                  # Bun 1.4.4+
cp backend/.env.example backend/.env
bun run preload                              # Postgres, Redis, S3, Mailpit + migrations
bun run dev                                  # frontend :3000, backend :3001
```

Mobile: `bun run ios` builds and installs the development client once; after that `bun run dev` serves it. Rebuild only after changing native packages.

### Branches

- **`main`** is production. Nobody pushes to it directly.
- **`staging`** is the integration branch. Work lands here first.
- Work on a short-lived branch off `staging`, named by type: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Open the pull request **into `staging`**. Releases go to `main` through a "Staging to Production" pull request, after which `staging` is reset to `main` automatically (`reset-staging.yml`). Anything pushed to `staging` after that merge must be rebased, so finish your branch before a release goes out.

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

```
feat(attendance): live teacher position for location check-in
fix(webhooks): accept PEM bundles pasted with trailing spaces
chore(deps): pin deepmerge below the vulnerable range
```

- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`.
- Scope is the area: a backend module (`grading`, `attendance`, `chat`, …), `frontend`, `mobile`, `infra`, `docs`, `deps`.
- The summary says what changes, in the imperative, without a trailing full stop. The body (optional) says why.

### Before you open a pull request

Run these from the repository root and make sure they pass:

```bash
bun run lint     # typecheck + lint, every workspace
bun run test     # every workspace
bun run build
bun audit        # no new vulnerabilities
```

`bun test` does **not** typecheck, so a test file can have type errors that only `bun run lint` (or `bunx tsc --noEmit` in the workspace) finds.

CI runs the same checks on every push and pull request; the **CI Gate** status check must be green before a merge. Changes under `infrastructure/` also run the Infrastructure workflow (Docker image build, Caddyfile and Compose validation, and the PM2 smoke test).

### Pull requests

- Keep each pull request to one change. Large features can land in steps.
- Describe what changed, why, and how you tested it. Link the issue if there is one.
- Include screenshots or a short recording for UI changes, on web and mobile where both are affected.
- Call out anything a deployer must do: new environment variables, migrations, a mobile rebuild, an ordering requirement (for example "deploy the API before the app").

### Code conventions

**Everywhere**

- TypeScript throughout; match the style of the surrounding code. Prettier and ESLint configs are in each workspace.
- Every module folder has a `README.md`. Update it when you change what the module does, and update `docs/content/` when behaviour visible to schools, teachers or students changes.
- Never name new files, classes, services or environment variables after Supabase: the platform no longer uses it.
- Never commit secrets or `.env` files. New settings go in the matching `.env.example` (`backend/.env.example`, `infrastructure/env.example`) and in `docs/content/environment-variables.md`.

**Backend** (`backend/`)

- All authorisation lives in the API: there is no row-level security. Every query must be scoped to the caller's school and role, through the existing guards and helpers (`CourseAccessService` for course data).
- Validate request bodies with DTOs; unknown fields are rejected.
- Use Prisma for queries. Raw SQL only through tagged templates (`$queryRaw\`…\``), never string-built.
- Add tests next to the code (`*.test.ts`, `bun:test`) for every behaviour change, including the refusal paths.

**Database** (`backend/prisma/`)

- Change the `.prisma` schema files and add a new migration; never edit a migration that has been applied.
- Migrations are forward-only. If a change needs a backfill or a two-step rollout, say so in the pull request.
- Some indexes exist only in SQL because Prisma cannot express them; see `backend/prisma/migrations/README.md` before deleting `DROP INDEX` lines that `migrate dev` generates.

**Frontend** (`frontend/`)

- This is Next.js 16. Read `frontend/AGENTS.md`: APIs and conventions differ from older versions, so check `node_modules/next/dist/docs/` before relying on what you remember.
- `NEXT_PUBLIC_*` values are inlined at build time; changing one needs a rebuild.

**Mobile** (`mobile/`)

- Expo with a committed `ios/` project. Adding or upgrading a native package means rebuilding the development client (`bun run ios`) and an EAS build for release.
- Avoid dynamic `import()` of native packages: production bundles split them into chunks that cannot load on a device.
- The app must keep working against an API one release older, so new request fields should be optional on the server side first.

**Infrastructure** (`infrastructure/`)

- Docker Compose (with Caddy) is the primary deployment; `infrastructure/pm2/` is the bare-metal option. Keep both working when you change ports, environment variables or the build.
- Pin image versions and GitHub Actions to exact versions (actions by commit SHA with a version comment).

### Dependencies

- Add dependencies to the workspace that uses them, not the root.
- Commit `bun.lock` with any dependency change; CI installs with `--frozen-lockfile`.
- Overrides in the root `package.json` exist for security reasons; check `bun audit` and the advisory before changing one.

## Questions

Collaborators can ask in the team channel or contact [daulric](https://daulric.dev). Everyone else: open an issue for bugs, or email security@daulric.dev for anything security-related.
