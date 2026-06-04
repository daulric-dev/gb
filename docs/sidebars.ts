import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";
import { readdirSync, readFileSync, statSync } from "fs";

function sidebarPosition(file: string): number {
  try {
    const match = /sidebar_position:\s*(\d+)/.exec(readFileSync(file, "utf8"));
    return match ? Number(match[1]) : 999;
  } catch {
    return 999;
  }
}

function GetChangeLogFiles() {
  const changelogDir = `${__dirname}/content/changelog`;
  const dates = readdirSync(changelogDir)
    .filter((name) => {
      try {
        return statSync(`${changelogDir}/${name}`).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a));

  const entries: string[] = [];
  for (const date of dates) {
    const dir = `${changelogDir}/${date}`;
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort((a, b) => sidebarPosition(`${dir}/${a}.md`) - sidebarPosition(`${dir}/${b}.md`) || a.localeCompare(b))
      .forEach((entry) => entries.push(`${date}/${entry}`));
  }
  return entries;
}

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "implementation-guide",
        "environment-variables",
        "dedicated-deployment",
      ],
    },
    {
      type: "category",
      label: "Backend",
      collapsed: false,
      link: { type: "doc", id: "backend/overview" },
      items: [
        "backend/auth",
        "backend/school",
        "backend/academic-year",
        "backend/term",
        "backend/subject",
        "backend/class",
        "backend/student",
        "backend/enrollment",
        "backend/grading",
        "backend/calculation",
        "backend/reporting",
        "backend/report-files",
        "backend/announcement",
        "backend/images",
        "backend/cache",
        "backend/versioning",
      ],
    },
    {
      type: "category",
      label: "Frontend",
      collapsed: false,
      link: { type: "doc", id: "frontend/overview" },
      items: [
        "frontend/auth-pages",
        "frontend/dashboard",
        "frontend/academic-years",
        "frontend/terms",
        "frontend/students",
        "frontend/subjects",
        "frontend/classes",
        "frontend/grading",
        "frontend/reporting",
        "frontend/announcements",
        "frontend/components",
        "frontend/utilities",
      ],
    },
    {
      type: "category",
      label: "CLI",
      collapsed: false,
      link: { type: "doc", id: "cli/overview" },
      items: [
        "cli/commands",
        "cli/service-registry",
        "cli/interactive-prompts",
      ],
    },
    {
      type: "category",
      label: "Changelog",
      collapsed: false,
      link: { type: "doc", id: "changelog/overview" },
      items: [
        ...GetChangeLogFiles().map((file) => `changelog/${file}`),
      ],
    },
  ],
};

export default sidebars;