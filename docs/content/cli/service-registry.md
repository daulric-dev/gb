---
sidebar_label: Service Registry
---

# Service Registry (`_mr.json`)

`_mr.json` lives at the repo root and tells the `gb` CLI which directories belong to which services. It replaces hardcoded service lists so you can adapt the CLI to any monorepo layout without touching source code.

## File format

```json
{
  "root": "/Users/you/gbv2",
  "services": [
    { "name": "frontend",       "paths": ["frontend"] },
    { "name": "backend",        "paths": ["backend"] },
    { "name": "ci",             "paths": [".github", "infrastructure"] },
    { "name": "docs",           "paths": ["docs"] }
  ],
  "protectedBranches": ["main", "master", "staging"]
}
```

### `services`

An array of service definitions. Each entry has:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The service name shown in selectors and used in commit messages |
| `paths` | `string[]` | Directory prefixes that belong to this service |

A file is matched to a service when its path starts with any entry in `paths`. If no match is found, the file falls under the built-in `root` service.

**Multi-path services** allow logically grouping unrelated directories under one name:

```json
{ "name": "ci", "paths": [".github", "infrastructure"] }
```

Running `gb commit` and selecting `ci` will stage and commit all changed files under both `.github/` and `infrastructure/` in a single commit.

**Backwards compatibility:** Plain strings are also accepted and treated as `{ name: entry, paths: [entry] }`:

```json
"services": ["frontend", "backend"]
```

### `root`

Optional. When set, all `gb` commands use this path as the monorepo working directory instead of auto-detecting via `git rev-parse --show-toplevel`.

```json
"root": "/Users/you/gbv2"
```

If the configured root is a subdirectory of the git root, `gb commit` automatically computes the relative prefix so service paths are resolved correctly against the git status output.

Manage it with:
```bash
gb service root           # show current root
gb service root set       # edit with a pre-filled prompt
gb service root clear     # remove and fall back to git detection
```

### `protectedBranches`

Optional. Defaults to `["main", "master", "staging"]` if omitted.

Branches listed here trigger automatic feature-branch creation when you run `gb commit` on them.

## Managing services with `gb service`

Instead of editing `_mr.json` by hand, use the `gb service` command:

```bash
gb service               # list all registered services and their paths
gb service add           # prompts for name then paths
gb service edit          # select a service and edit its paths in-place
gb service remove        # interactive selector to pick which to remove
gb service root set      # update the monorepo root path
```

See [`gb service`](./commands.md#service) for full details.

## How paths are resolved

`constants.ts` reads `_mr.json` at startup and builds a flat `path → service name` map:

```
frontend       → frontend
backend        → backend
.github        → ci
infrastructure → ci
docs           → docs
```

`getServiceForPath` in `utils.ts` walks this map and returns the first matching prefix. Any file that doesn't match falls through to `root`.

### Commit path resolution

`git status --porcelain` always returns paths relative to the git root. When `root` in `_mr.json` is a subdirectory of the git root, `gb commit` computes a `rootPrefix` (e.g. `gbv2/`) and prepends it to service paths when filtering files. The prefix is stripped again before calling `git add`, since git runs with `cwd` set to the configured root.

When `root` matches the git root (the typical case), the prefix is empty and there is no difference in behaviour.

This means:
- Adding a service to `_mr.json` immediately changes how `gb status`, `gb commit`, and `gb diff` group files
- Renaming a service's `name` only affects display and commit message format - the paths stay the same
- A file can only belong to one service (first prefix match wins)

## Example: grouping CI and infrastructure

Before:

```json
{ "name": ".github", "paths": [".github"] },
{ "name": "infrastructure", "paths": ["infrastructure"] }
```

After merging into one service:

```json
{ "name": "ci", "paths": [".github", "infrastructure"] }
```

Now `gb commit → ci` stages changes from both directories under a single `feat(ci): ...` commit, and `gb status` shows them grouped together.
