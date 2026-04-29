import { readFileSync } from "fs";
import { join } from "path";

interface MrConfig {
  services: string[];
  protectedBranches?: string[];
}

function loadConfig(): MrConfig {
  const configPath = join(import.meta.dir, "../_mr.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as MrConfig;
  } catch {
    throw new Error(`_mr.json not found at ${configPath}. Add it to your repo root to register services.`);
  }
}

const config = loadConfig();

export const SERVICES: Record<string, string> = Object.fromEntries(
  config.services.map((s) => [s, s]),
);

export const ALL_SERVICES: string[] = ["root", ...config.services];

export const PROTECTED_BRANCHES: string[] = config.protectedBranches ?? ["main", "master", "staging"];

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
