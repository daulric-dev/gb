import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

const CONTENT = "content";

/** Section order, mirroring how the docs have always been arranged. */
const SECTIONS: { label: string; dir?: string; items?: string[] }[] = [
  {
    label: "Getting Started",
    items: [
      "developer-guide",
      "implementation-guide",
      "environment-variables",
      "dedicated-deployment",
      "edge-functions",
      "mobile-production",
    ],
  },
  { label: "User Guide", dir: "guide" },
  { label: "Backend", dir: "backend" },
  { label: "Frontend", dir: "frontend" },
  { label: "CLI", dir: "cli" },
];

export interface NavItem {
  slug: string;
  label: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

function frontmatterOf(file: string): { label?: string; position: number } {
  try {
    const raw = readFileSync(file, "utf8");
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!block) return { position: 999 };

    const label = /^sidebar_label:\s*(.*)$/m.exec(block[1])?.[1];
    const position = /^sidebar_position:\s*(\d+)$/m.exec(block[1])?.[1];

    return {
      label: label?.replace(/^["']|["']$/g, "").trim(),
      position: position ? Number(position) : 999,
    };
  } catch {
    return { position: 999 };
  }
}

function titleFrom(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function markdownIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function directoriesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function itemFor(root: string, slug: string): NavItem {
  const { label } = frontmatterOf(join(root, `${slug}.md`));
  return { slug, label: label ?? titleFrom(slug) };
}

/** A section listing a directory: its own `overview` first, then the rest. */
function sectionFromDir(root: string, label: string, dir: string): NavSection {
  const base = join(root, dir);
  const names = markdownIn(base)
    .map((f) => f.replace(/\.md$/, ""))
    .sort((a, b) => {
      if (a === "overview") return -1;
      if (b === "overview") return 1;
      const pa = frontmatterOf(join(base, `${a}.md`)).position;
      const pb = frontmatterOf(join(base, `${b}.md`)).position;
      return pa - pb || a.localeCompare(b);
    });

  return {
    label,
    items: names.map((name) => itemFor(root, `${dir}/${name}`)),
  };
}

/** Newest date first; entries inside a date by their declared position. */
function changelogSection(root: string): NavSection {
  const base = join(root, "changelog");
  const items: NavItem[] = [];

  if (markdownIn(base).includes("overview.md")) {
    items.push(itemFor(root, "changelog/overview"));
  }

  for (const date of directoriesIn(base).sort((a, b) => b.localeCompare(a))) {
    const dir = join(base, date);
    const names = markdownIn(dir)
      .map((f) => f.replace(/\.md$/, ""))
      .sort((a, b) => {
        const pa = frontmatterOf(join(dir, `${a}.md`)).position;
        const pb = frontmatterOf(join(dir, `${b}.md`)).position;
        return pa - pb || a.localeCompare(b);
      });

    for (const name of names) {
      items.push(itemFor(root, `changelog/${date}/${name}`));
    }
  }

  return { label: "Changelog", items };
}

function buildNav(root: string): NavSection[] {
  const sections: NavSection[] = [];

  for (const section of SECTIONS) {
    if (section.items) {
      sections.push({
        label: section.label,
        items: section.items
          .filter((slug) => {
            try {
              statSync(join(root, `${slug}.md`));
              return true;
            } catch {
              return false;
            }
          })
          .map((slug) => itemFor(root, slug)),
      });
      continue;
    }
    if (section.dir) {
      sections.push(sectionFromDir(root, section.label, section.dir));
    }
  }

  sections.push(changelogSection(root));
  return sections.filter((s) => s.items.length > 0);
}

const VIRTUAL = "virtual:docs-nav";

export function docsNav(): Plugin {
  let root = "";

  return {
    name: "docs-nav",
    configResolved(config) {
      root = join(config.root, CONTENT);
    },
    resolveId(id) {
      return id === VIRTUAL ? `\0${VIRTUAL}` : null;
    },
    load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      return `export default ${JSON.stringify(buildNav(root))};`;
    },
    /** Adding or retitling a page updates the sidebar without a restart. */
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".md")) return;
      if (relative(root, file).startsWith("..")) return;

      const mod = server.moduleGraph.getModuleById(`\0${VIRTUAL}`);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: "full-reload" });
    },
  };
}
