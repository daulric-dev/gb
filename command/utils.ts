import { SERVICES } from "./constants";

export async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
  return stdout.replace(/\n$/, "");
}

export async function getCurrentBranch(): Promise<string> {
  return git("rev-parse", "--abbrev-ref", "HEAD");
}

export function getServiceForPath(filePath: string): string {
  for (const [prefix, name] of Object.entries(SERVICES)) {
    if (filePath.startsWith(`${prefix}/`)) return name;
  }
  return "root";
}

export function groupByService(
  files: { status: string; path: string }[],
): Record<string, { status: string; path: string }[]> {
  const groups: Record<string, { status: string; path: string }[]> = {};
  for (const file of files) {
    const service = getServiceForPath(file.path);
    (groups[service] ??= []).push(file);
  }
  return groups;
}

export function parseStatusOutput(output: string): { status: string; path: string }[] {
  if (!output) return [];
  return output.split("\n").map((line) => {
    const status = line.slice(0, 2).trim();
    const path = line.slice(3);
    return { status, path };
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function parseArgs(argv: string[]): {
  command: string;
  positionals: string[];
  flags: Record<string, string>;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  let i = 1;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = args[++i] ?? "true";
      }
    } else if (arg === "-m") {
      flags["m"] = args[++i] ?? "";
    } else {
      positionals.push(arg);
    }
    i++;
  }

  return { command, positionals, flags };
}
