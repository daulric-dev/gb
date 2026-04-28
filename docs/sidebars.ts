import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

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
        "cli/interactive-prompts",
      ],
    },
  ],
};

export default sidebars;
