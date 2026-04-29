export const SERVICES: Record<string, string> = {
  frontend: "frontend",
  backend: "backend",
  docs: "docs",
  ".github": ".github",
  command: "command",
  supabase: "supabase",
  infrastructure: "infrastructure",
};

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "ci",
  "perf",
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export const PROTECTED_BRANCHES = ["main", "master", "staging"];
