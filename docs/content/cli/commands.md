---
sidebar_label: Commands
---

# CLI Commands

Detailed documentation for each `gb` command.

---

## Status

```bash
gb status
```

Shows `git status --porcelain` output grouped by service. Each service is color-coded with file counts.

**Example output:**
```
backend (3 files)
  M  src/auth/auth.controller.ts
  M  src/images/images.service.ts
  ??  src/images/transformer.ts

frontend (2 files)
  M  lib/api.ts
  M  components/layout/app-sidebar.tsx
```

---

## Affected

```bash
gb affected [--base=main]
```

Lists which services have changes compared to a base branch. Useful for CI pipelines and selective builds.

**Options:**
| Flag | Default | Description |
|------|---------|-------------|
| `--base` | `main` | Base branch to compare against |

Outputs a space-separated list of affected service names (e.g., `backend frontend`).

---

## Branch

```bash
gb branch [service] [name]
gb branch [service] [name] --type=feat
gb branch --custom "my branch name"
```

Creates a new branch scoped to a service.

**Options:**
| Flag | Description |
|------|-------------|
| `--type=<type>` | Optional type prefix (e.g., `feat`, `fix`). Produces `type(service)/name` format |
| `--custom` | Skip service and type selection, create a branch with a freeform name |

**Interactive mode** (no arguments):

1. Prompted to select a service (or "custom" for freeform)
2. If a service is selected, prompted to select a type (or "skip")
3. Prompted for a branch name
4. Branch is created and checked out

**Branch name formats:**

| Inputs | Result |
|--------|--------|
| Service: `frontend`, Type: `feat`, Name: `add auth` | `feat(frontend)/add-auth` |
| Service: `frontend`, Type: skip, Name: `add auth` | `frontend(add-auth)` |
| Custom, Name: `best branch ever` | `best-branch-ever` |

**Protected branch warning:** If the current branch is not protected (`main`/`master`/`staging`), a confirmation prompt is shown before creating.

---

## Commit

```bash
gb commit [service]
gb commit [service] --topic "topic" --type=feat
gb commit [service] --topic "topic" -m "message" --type=fix
```

Interactive commit flow scoped to a single service, with support for **multi-service commits** in a single session.

**Options:**
| Flag | Default | Description |
|------|---------|-------------|
| `--topic "..."` | prompted | Commit subject (required, max 10 words) |
| `-m "..."` | prompted | Optional extended commit body |
| `--type=<type>` | `feat` | Commit type prefix |

### Single commit flow

1. **Service selection** — if not provided as an argument, an interactive arrow-key selector is shown
2. **Topic** — if `--topic` is not provided, you're prompted with a live word counter (limit: 10 words). If you exceed the limit, the topic is trimmed automatically
3. **Message** — optional extended commit body
4. **Protected branch check** — if on `main`/`master`/`staging`, a new branch is auto-created (e.g., `feat(frontend)/add-auth`) before committing
5. **Stage & commit** — all changed files for the selected service are staged and committed

### Multi-service commit loop

After each commit:

1. Checks for remaining uncommitted changes
2. Shows a **summary of remaining changes** grouped by service:
   ```
   Remaining changes:
     backend (2 files)
     docs (1 file)

   Commit another service? (yes / no)
   ```
3. If **yes** — prompts for a new service, topic, and message (each commit is independent)
4. If **no** — exits
5. If there are no more changes — exits automatically with "No more changes to commit"

**Key behaviors:**
- The protected branch check only runs once (first commit)
- If a selected service has no changes, a warning is shown and the loop continues
- Each subsequent commit defaults to `feat` type
- CLI flags (`--topic`, `-m`, `--type`) only apply to the first commit
- Services with multiple paths (e.g., `ci` covering `.github/` and `infrastructure/`) stage all matching files under a single commit

### Commit message format

```
type(service): topic

message (optional)
```

Examples:
- `feat(frontend): add avatar upload`
- `fix(backend): handle null avatar url\n\ncheck for missing profile before download`
- `docs: update cli documentation` (root service omits parentheses)

---

## Checkout

```bash
gb checkout [branch]
```

Switches to a branch and pulls the latest changes from origin. Fetches remote refs first so remote-only branches are visible.

**Interactive mode** (no argument):

An arrow-key selector lists all available branches:
- Local branches are shown with a plain prefix
- Remote-only branches (not yet tracked locally) are marked with `↓`

Selecting a remote-only branch automatically creates a local tracking branch (`git checkout -b <branch> --track origin/<branch>`).

**Direct mode:**

```bash
gb checkout main
gb checkout feat(backend)/add-auth
```

Pass the branch name directly to skip the selector.

**Behavior after switching:**

Runs `git pull origin <branch>` to bring the branch fully up to date. If the pull cannot fast-forward, a warning is shown and you can pull manually.

---

## Sync

```bash
gb sync
```

Removes local branches that no longer exist on the remote (e.g., after a PR is merged and the branch is deleted on GitHub).

1. Runs `git fetch --prune origin` to update remote-tracking refs
2. Finds all local branches marked as `gone` (no remote counterpart)
3. Lists them and prompts for confirmation before deleting
4. Skips the currently checked-out branch if it appears in the list

---

## Diff

```bash
gb diff [service]
```

Shows the git diff, optionally scoped to a service.

| Usage | Behavior |
|-------|----------|
| `gb diff` | `git diff --stat` (summary of all changes) |
| `gb diff backend` | Full diff for `backend/` only |
| `gb diff root` | Full diff for root-level files (excludes all service directories) |

---

## Push

```bash
gb push [--force]
```

Pushes the current branch to origin.

**Options:**
| Flag | Description |
|------|-------------|
| `--force` | Force push with `--force-with-lease` (safe force push) |

On first push (no upstream set), automatically runs `git push -u origin <branch>`.

---

## Run

```bash
gb run <service> <script>
```

Runs a `package.json` script in a service directory using Bun.

**Examples:**
```bash
gb run backend test         # runs "bun run test" in backend/
gb run frontend lint        # runs "bun run lint" in frontend/
```

Inherits stdin/stdout/stderr, so interactive scripts work. The exit code from the script is propagated.

---

## Service

```bash
gb service
gb service list
gb service add
gb service edit
gb service remove
gb service root [show|set|clear]
```

Manages the service registry in `_mr.json`. See [Service Registry](./service-registry.md) for the full config format.

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `gb service` / `gb service list` | Print all registered services with their mapped paths |
| `gb service add` | Register a new service — prompts for name then paths |
| `gb service edit` | Select a service and edit its paths in-place |
| `gb service remove` | Remove a service (interactive selector) |
| `gb service root` | Show the configured monorepo root |
| `gb service root set` | Set the monorepo root path in `_mr.json` |
| `gb service root clear` | Remove the root override (falls back to git detection) |

**Listing services:**

```
Registered services:
  frontend   → frontend
  backend    → backend
  ci         → .github, infrastructure
  root       → (built-in — catches unregistered paths)
```

**Adding a service:**

```
gb service add
Service name: api
Paths (comma-separated): api, shared
Added api → api, shared
```

The paths field is pre-filled with the service name — press enter to keep it, or type a comma-separated list to override.

**Editing a service:**

```
gb service edit
❯ backend
  frontend
  ci

Paths (comma-separated): backend, shared
Updated backend → backend, shared
```

The paths field opens pre-filled with the current value so you can backspace and edit in place.

**Managing the monorepo root:**

```bash
gb service root           # Root: /Users/you/gbv2 (detected from git)
gb service root set       # opens pre-filled prompt to change it
gb service root clear     # removes override, reverts to git detection
```

When a root is configured in `_mr.json`, all `gb` commands use it as the working directory instead of auto-detecting via `git rev-parse --show-toplevel`.

**Notes:**
- `root` is a built-in pseudo-service and cannot be added, edited, or removed
- Changes to `_mr.json` take effect on the next `gb` invocation (config is loaded at startup)

---

## Help

```bash
gb help
gb --help
gb -h
```

Displays help text loaded from `command/help.json`. Shows all commands, their options, available services, and usage examples.
