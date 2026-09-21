/**
 * Where a link in a markdown file should actually point.
 *
 * The content was written for a docs generator that resolved relative paths
 * against the file on disk, and it contains three kinds of link:
 *
 *   - `./other.md`, `../dir/other.md` - another page, relative to this one;
 *   - `../../../../backend/src/x.ts` - a source file, which climbs out of the
 *     content tree entirely. These were dead links in the old site. Here they
 *     become links into the repository on GitHub, which is where that file
 *     actually is;
 *   - `#anchor`, and ordinary external URLs, which pass through.
 */

const REPO = "https://github.com/daulric-dev/gb";
const BRANCH = "main";

export type ResolvedLink =
  | { kind: "internal"; slug: string; hash: string }
  | { kind: "external"; href: string }
  | { kind: "anchor"; href: string };

/** Collapse `a/b/../c` to `a/c`, dropping any leading climbs. */
function normalise(segments: string[]): { path: string[]; climbedOut: number } {
  const out: string[] = [];
  let climbedOut = 0;

  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (out.length > 0) out.pop();
      else climbedOut++;
      continue;
    }
    out.push(segment);
  }

  return { path: out, climbedOut };
}

export function resolveLink(href: string, fromSlug: string): ResolvedLink {
  if (!href) return { kind: "external", href };

  if (href.startsWith("#")) return { kind: "anchor", href };

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return { kind: "external", href };
  }

  const [rawPath, hash = ""] = href.split("#");

  // Relative links resolve against the directory the file lives in.
  const fromDir = fromSlug.split("/").slice(0, -1);
  const { path, climbedOut } = normalise([
    ...fromDir,
    ...rawPath.split("/"),
  ]);

  // Climbing above `content/` means the target is somewhere else in the repo -
  // source files, almost always - so send the reader to GitHub.
  if (climbedOut > 0) {
    return {
      kind: "external",
      href: `${REPO}/blob/${BRANCH}/${path.join("/")}`,
    };
  }

  const slug = path.join("/").replace(/\.md$/, "");
  return { kind: "internal", slug, hash: hash ? `#${hash}` : "" };
}

/** GitHub's heading-anchor rules, so in-page `#links` keep working. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}
