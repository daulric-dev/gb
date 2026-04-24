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

## Architecture

```
command/
├── index.ts       # Entrypoint — parses args, dispatches to commands
├── commands.ts    # All command implementations
├── constants.ts   # Services, commit types, protected branches
├── prompts.ts     # Interactive terminal UI (prompt, select, word limit)
├── utils.ts       # Git helpers, path mapping, arg parsing
├── timer.ts       # Execution timer
└── help.json      # Help text data (loaded at runtime)
```

## Services

The CLI recognizes these service directories in the monorepo:

| Service | Directory |
|---------|-----------|
| `frontend` | `frontend/` |
| `backend` | `backend/` |
| `docs` | `docs/` |
| `.github` | `.github/` |
| `command` | `command/` |
| `root` | Everything else (root-level files like `package.json`, `turbo.json`, etc.) |

Defined in `constants.ts` as the `SERVICES` map. The `root` pseudo-service captures files not under any service directory.

## Protected Branches

The following branches are considered protected: `main`, `master`, `staging`.

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
| [`gb commit`](./commands.md#commit) | Stage and commit files for a service (multi-service loop) |
| [`gb diff`](./commands.md#diff) | Show diff for a service or all |
| [`gb push`](./commands.md#push) | Push current branch to origin |
| [`gb run`](./commands.md#run) | Run a package.json script in a service |
| `gb help` | Show help |

See [commands.md](./commands.md) for detailed documentation on each command.

## Git Helper

All git operations run through a centralized `git()` function in `utils.ts` that:

1. Detects the repository root via `git rev-parse --show-toplevel` (cached after first call)
2. Always runs from the repo root regardless of the user's current directory
3. Throws descriptive errors on non-zero exit codes

This means `gb` works from any subdirectory in the monorepo.
