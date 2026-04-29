---
sidebar_label: Service Registry
---

# Service Registry (`_mr.json`)

`_mr.json` lives at the repo root and tells the `gb` CLI which directories belong to which services. It replaces hardcoded service lists so you can adapt the CLI to any monorepo layout without touching source code.

## File format

```json
{
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

### `protectedBranches`

Optional. Defaults to `["main", "master", "staging"]` if omitted.

Branches listed here trigger automatic feature-branch creation when you run `gb commit` on them.

## Managing services with `gb service`

Instead of editing `_mr.json` by hand, use the `gb service` command:

```bash
gb service               # list all registered services and their paths
gb service add           # interactive: prompts for name and paths
gb service add api       # add "api" service, prompts for paths
gb service remove        # interactive selector
gb service remove docs   # remove "docs" directly
```

See [`gb service`](./commands.md#service) for full details.

## How paths are resolved

`constants.ts` reads `_mr.json` at startup and builds a flat `path → service name` map:

```
frontend     → frontend
backend      → backend
.github      → ci
infrastructure → ci
docs         → docs
```

`getServiceForPath` in `utils.ts` walks this map and returns the first matching prefix. Any file that doesn't match falls through to `root`.

This means:
- Adding a service to `_mr.json` immediately changes how `gb status`, `gb commit`, and `gb diff` group files
- Renaming a service's `name` only affects display and commit message format — the paths stay the same
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
