---
sidebar_label: Overview
---

# CLI Overview (`gb`)

**Location**: `command/`

The `gb` CLI is a monorepo-aware Git tool that scopes git operations to individual services. It prevents accidental cross-service commits and provides interactive prompts for common workflows.

## Setup

```bash
bun link        # registers "gbsh" globally
```

Or run directly:

```bash
bun run gb <command>
```

## Building the Monorepo

All workspaces (frontend, backend, docs) are built via [Turbo](https://turbo.build/):

```bash
bun run build              # build all workspaces
bun run build:frontend     # Next.js production build
bun run build:backend      # NestJS production build
bun run build:docs         # Docusaurus static site
```

### Compiling the backend to a standalone binary

```bash
bun run compile
```

Runs `turbo run build` across all workspaces, then uses `bun build --compile` to produce a single native binary at `./dist/server`. The binary bundles the backend and all its dependencies — no Bun or Node.js installation required to run it.

The frontend and docs cannot be compiled this way as they depend on the Next.js and Docusaurus runtimes respectively.

## Architecture

```
command/
├── index.ts       # Entrypoint — parses args, dispatches to commands
├── commands.ts    # Command implementations (status, commit, branch, push, …)
├── pr.ts          # PR/MR creation — GitHub, GitLab, Bitbucket API
├── constants.ts   # Loads _mr.json; exports SERVICES, ALL_SERVICES, PROTECTED_BRANCHES
├── prompts.ts     # Interactive terminal UI (prompt, select, word limit)
├── utils.ts       # Git helpers, remote URL parsing, arg parsing
├── timer.ts       # Execution timer
└── help.json      # Help text data (loaded at runtime)
_mr.json           # Service registry — defines services and protected branches
```

## Services

Services are defined in [`_mr.json`](./service-registry.md) at the repo root rather than being hardcoded. Each entry maps a service name to one or more directory paths.

```json
{ "name": "backend", "paths": ["backend"] }
```

`constants.ts` reads this file at startup and builds:
- `SERVICES` — a flat `path → name` map used to group files
- `ALL_SERVICES` — the list of service names shown in selectors (always includes `root`)

The built-in `root` pseudo-service captures any file not covered by a registered path.

To add, remove, or inspect services use [`gb service`](./commands.md#service).

## Protected Branches

Protected branches are configured in `_mr.json` under `protectedBranches` (defaults to `main`, `master`, `staging` if omitted).

When committing on a protected branch, `gb commit` automatically creates a new feature branch before committing. When creating a branch from a non-protected branch, a confirmation prompt is shown.

## Commit Types

Used for branch naming and commit message prefixes:

`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`

## Execution Timer

Every command displays its execution time on completion (e.g., `Done in 142ms` or `Done in 1.23s`).

## Commands

| Command | Description |
|---------|-------------|
| [`gb status`](./commands.md#status) | Show git status grouped by service |
| [`gb affected`](./commands.md#affected) | List services with changes vs a base branch |
| [`gb branch`](./commands.md#branch) | Create a service-scoped branch |
| [`gb checkout`](./commands.md#checkout) | Switch to a branch and pull latest changes |
| [`gb commit`](./commands.md#commit) | Stage and commit files for a service (multi-service loop) |
| [`gb diff`](./commands.md#diff) | Show diff for a service or all |
| [`gb sync`](./commands.md#sync) | Delete local branches that no longer exist on remote |
| [`gb push`](./commands.md#push) | Push current branch to origin |
| [`gb pr`](./commands.md#pr) | Create a pull request via GitHub, GitLab, or Bitbucket API |
| [`gb service`](./commands.md#service) | Add, remove, or list registered services in `_mr.json` |
| [`gb run`](./commands.md#run) | Run a package.json script in a service |
| `gb help` | Show help |

See [commands.md](./commands.md) for detailed documentation on each command.

## Git Helper

All git operations run through a centralized `git()` function in `utils.ts` that:

1. Detects the repository root via `git rev-parse --show-toplevel` (cached after first call)
2. Always runs from the repo root regardless of the user's current directory
3. Throws descriptive errors on non-zero exit codes

This means `gb` works from any subdirectory in the monorepo.
