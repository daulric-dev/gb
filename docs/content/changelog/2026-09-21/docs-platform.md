---
sidebar_label: 2026-09-21 · Docs off Docusaurus
sidebar_position: 3
---

# 2026-09-21 - Docs moved from Docusaurus to Vite

The documentation site is now a small Vite + React application that renders the same Markdown through `react-markdown` and `remark-gfm`, published to GitHub Pages. **No document was rewritten.** All 84 files under `docs/content/` are byte-for-byte what they were; only the machinery around them changed.

## Why

Docusaurus is a documentation platform, and this is a documentation folder. The gap between the two was all cost:

- It pulled in its own build pipeline, MDX compiler, SSR renderer and theme system. The lockfile shed roughly 1,900 lines when it left - the great majority of the repository's documentation dependency surface for a site that is a sidebar and a column of text.
- Every page was compiled as MDX, which meant Markdown was parsed as a superset of itself: a stray `<` or `{` in a code sample or an env-var table was a build error rather than a character.
- Publishing meant a framework build with a server-rendering step for pages that have no server behaviour.

The replacement is five runtime dependencies (`react`, `react-dom`, `react-markdown`, `react-router-dom`, `remark-gfm`) and Vite.

## How it works now

Four moving parts, all small:

- **`docs/plugins/docs-nav.ts`** - a Vite plugin that reads each file's frontmatter with `fs` at build time and emits the sidebar as the virtual module `virtual:docs-nav`. Doing this in the browser would have meant loading all 84 documents just to read `sidebar_label` and `sidebar_position` from each, which would put the entire manual in the entry chunk. Section order is declared (Getting Started, Backend, Frontend, CLI) because it is editorial; the changelog is generated newest-date-first so publishing an entry never requires editing a list.
- **`src/lib/content.ts`** - a lazy `import.meta.glob("../../content/**/*.md", { query: "?raw" })`. Each document becomes its own chunk, fetched when its page is opened.
- **`src/lib/links.ts`** - rewrites Markdown links at render time. Relative links between documents become router paths; a link that climbs above `content/` is pointing at source, so it is rewritten to `https://github.com/daulric-dev/gb/blob/main/<path>` rather than 404ing.
- **`src/components/`** - `App` (shell and routes), `Sidebar`, `Doc` (frontmatter strip, `react-markdown`, anchored headings).

Frontmatter is stripped before rendering and its `sidebar_label` is reused as the page title, so the existing headers keep working untouched.

### Output

84 documents build to 84 lazily-loaded chunks plus a 412kB entry (128kB gzipped) and 3.7kB of CSS, in about half a second.

## GitHub Pages

The site is served from a project page, so it is built under a base path and the router is mounted to match:

- `base` defaults to `/gb/` and is overridable with `DOCS_BASE`, for a different repository name or a custom domain.
- The router's `basename` is read from `import.meta.env.BASE_URL`, so the two cannot drift.
- Pages has no SPA rewrite, so a deep link like `/gb/backend/file-manager` would otherwise 404 on refresh. A `spa-fallback` plugin copies `index.html` to `404.html` at the end of the build, which Pages serves for unknown paths and the router then resolves client-side.
- `public/.nojekyll` stops Pages running the output through Jekyll, which would drop the `_`-prefixed asset paths.

`.github/workflows/docs.yml` typechecks and builds on every push to `main` touching `docs/**`, then uploads and deploys. Deployments are serialised with `concurrency: pages`, `cancel-in-progress: true`, so a newer push supersedes an in-flight one instead of racing it.

## What was removed

`docusaurus.config.ts`, `sidebars.ts`, `src/pages/` (the marketing landing page), `src/css/custom.css`, `static/`, and the seven Docusaurus packages. The landing page was not replaced at the time, and `/` fell through to the implementation guide. It now renders `content/home.md`, an introduction that points at the user guide, the developer guide and the changelog - see [User guide and home page](./user-guide.md).

## Behaviour changes

| | Before | After |
|---|---|---|
| Authoring | MDX (JSX in Markdown) | Markdown + GFM |
| Search | Not configured | Not configured |
| Versioning | Available, unused | Not available |
| Dev server | `docusaurus start` | `vite` |
| Output | `docs/build` | `docs/build` |
| Port | 3002 | 3002 |

MDX is the one real loss: a document can no longer import a React component. Nothing in `docs/content/` did.

## Verified

- `tsc --noEmit` clean; `turbo run build` green across all workspaces.
- All 84 sidebar links present across 5 sections; navigation between pages is client-side, with no full reload.
- GFM tables render (8 tables / 36 rows on the environment page) and scroll within their own box rather than forcing the page sideways.
- Deep links resolve on direct load; an unknown slug shows an in-app "Not found" rather than a server 404.
- Source links rewrite correctly (15 on the 2026-05-29 entry, e.g. `backend/src/attendance/attendance.service.ts`).
- Dark mode persists across reloads; the sidebar collapses to a menu under 900px.
- No console errors on any page checked.
