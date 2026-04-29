import { readFileSync } from "fs";
import { join } from "path";

type ServiceEntry = string |  {
  name: string;
  paths: string[];
};

export interface NormalizedService {
  name: string;
  paths: string[];
}

interface MrConfig {
  root?: string;
  services: ServiceEntry[];
  protectedBranches?: string[];
}

function normalizedEntry(entry: ServiceEntry): NormalizedService {
  return typeof entry === "string" ? { name: entry, paths: [entry] } : entry;
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
const normalized = config.services.map(normalizedEntry);

export const SERVICES: Record<string, string> = Object.fromEntries(
  normalized.flatMap( ({name, paths}) => paths.map((p) => [p, name]) ),
);

export const CONFIGURED_ROOT: string | undefined = config.root;

export const NORMALIZED_SERVICES: NormalizedService[] = normalized;

export const ALL_SERVICES: string[] = ["root", ...normalized.map((e) => e.name)];

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
