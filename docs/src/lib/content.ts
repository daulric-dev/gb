/**
 * The docs content: every markdown file under `content/`, addressed by the
 * slug it is served at.
 *
 * Files are loaded lazily rather than eagerly. There are ~84 of them and about
 * 640KB of markdown; bundling all of it into the entry chunk would mean every
 * visitor downloads the whole manual to read one page. Each document instead
 * becomes its own chunk, fetched when that route opens.
 */

/** `content/backend/auth.md` → `backend/auth` */
function toSlug(path: string): string {
  return path
    .replace(/^.*\/content\//, "")
    .replace(/\.md$/, "");
}

const loaders = import.meta.glob("../../content/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const bySlug = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(loaders)) {
  bySlug.set(toSlug(path), load);
}

export const slugs: string[] = [...bySlug.keys()].sort();

export function hasDoc(slug: string): boolean {
  return bySlug.has(slug);
}

export async function loadDoc(slug: string): Promise<string | null> {
  const load = bySlug.get(slug);
  return load ? load() : null;
}

export interface Frontmatter {
  sidebar_label?: string;
  sidebar_position?: number;
  [key: string]: string | number | undefined;
}

/**
 * Split YAML frontmatter from the body.
 *
 * Deliberately not a YAML parser: the only keys these files use are flat
 * `key: value` pairs, and pulling in a parser to read two of them would undo
 * the point of this rewrite.
 */
export function parseFrontmatter(raw: string): {
  data: Frontmatter;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!pair) continue;

    const value = pair[2].replace(/^["']|["']$/g, "").trim();
    data[pair[1]] = /^-?\d+$/.test(value) ? Number(value) : value;
  }

  return { data, body: raw.slice(match[0].length) };
}

/** A readable fallback when a file has no `sidebar_label`. */
export function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
