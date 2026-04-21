#!/usr/bin/env bun

export {};

const SERVICES: Record<string, string> = {
  frontend: "frontend",
  backend: "backend",
  docs: "docs",
  ".github": ".github",
  command: "command",
};

const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "ci",
  "perf",
] as const;

const PROTECTED_BRANCHES = ["main", "master"];

// --- Git helpers ---

async function git(...args: string[]): Promise<string> {
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

async function getCurrentBranch(): Promise<string> {
  return git("rev-parse", "--abbrev-ref", "HEAD");
}

function getServiceForPath(filePath: string): string {
  for (const [prefix, name] of Object.entries(SERVICES)) {
    if (filePath.startsWith(`${prefix}/`)) return name;
  }
  return "root";
}

function groupByService(
  files: { status: string; path: string }[],
): Record<string, { status: string; path: string }[]> {
  const groups: Record<string, { status: string; path: string }[]> = {};
  for (const file of files) {
    const service = getServiceForPath(file.path);
    (groups[service] ??= []).push(file);
  }
  return groups;
}

function parseStatusOutput(output: string): { status: string; path: string }[] {
  if (!output) return [];
  return output.split("\n").map((line) => {
    const status = line.slice(0, 2).trim();
    const path = line.slice(3);
    return { status, path };
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function parseArgs(argv: string[]): {
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

function prompt(label: string): Promise<string> {
  process.stdout.write(`\x1b[1m${label}\x1b[0m `);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
      const input = Buffer.concat(chunks).toString().trim();
      if (input.includes("\n") || chunk.toString().includes("\n")) {
        process.stdin.pause();
        resolve(input.split("\n")[0].trim());
      } else {
        process.stdin.pause();
        resolve(input);
      }
    });
  });
}

function promptWithWordLimit(label: string, maxWords: number): Promise<string> {
  return new Promise((resolve) => {
    let input = "";

    const render = () => {
      const words = input.trim() ? input.trim().split(/\s+/) : [];
      const count = words.length;
      const counter =
        count > maxWords
          ? `\x1b[31m(${count}/${maxWords} words)\x1b[0m`
          : `\x1b[90m(${count}/${maxWords} words)\x1b[0m`;
      process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m ${input}${counter}`);
      // move cursor back before the counter so it sits right after the input text
      process.stdout.write(`\x1b[${counter.replace(/\x1b\[[^m]*m/g, "").length}D`);
    };

    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on("data", (data: Buffer) => {
      const key = data.toString();

      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const words = input.trim().split(/\s+/);
        if (input.trim() && words.length > maxWords) {
          process.stdout.write(`\r\x1b[2K\x1b[33mTopic trimmed to ${maxWords} words.\x1b[0m\n`);
          input = words.slice(0, maxWords).join(" ");
        } else {
          process.stdout.write("\n");
        }
        resolve(input.trim());
      } else if (key === "\x7f" || key === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          render();
        }
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        process.exit(130);
      } else if (key === "\x17") {
        // Ctrl+W: delete last word
        input = input.replace(/\s*\S+\s*$/, "");
        render();
      } else if (!key.startsWith("\x1b") && key >= " ") {
        input += key;
        render();
      }
    });
  });
}

function select(label: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    let cursor = 0;

    const render = () => {
      // Move up to overwrite previous render (skip on first render)
      if (rendered) {
        process.stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const marker = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
        const text = i === cursor ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
        process.stdout.write(`\x1b[2K${marker} ${text}\n`);
      }
    };

    let rendered = false;
    console.log(`\x1b[1m${label}\x1b[0m`);
    render();
    rendered = true;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data: Buffer) => {
      const key = data.toString();

      if (key === "\x1b[A" && cursor > 0) {
        cursor--;
        render();
      } else if (key === "\x1b[B" && cursor < options.length - 1) {
        cursor++;
        render();
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(options[cursor]);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.exit(130);
      }
    });
  });
}

// --- Commands ---

async function statusCmd() {
  const output = await git("status", "--porcelain");
  const files = parseStatusOutput(output);

  if (files.length === 0) {
    console.log("Working tree clean.");
    return;
  }

  const groups = groupByService(files);
  for (const [service, serviceFiles] of Object.entries(groups).sort()) {
    console.log(
      `\x1b[36m${service}\x1b[0m (${serviceFiles.length} file${serviceFiles.length !== 1 ? "s" : ""})`,
    );
    for (const f of serviceFiles) {
      console.log(`  \x1b[33m${f.status.padEnd(2)}\x1b[0m ${f.path}`);
    }
    console.log();
  }
}

async function affectedCmd(flags: Record<string, string>) {
  const base = flags["base"] ?? "main";

  let output: string;
  try {
    output = await git("diff", "--name-only", `${base}...HEAD`);
  } catch {
    output = await git("diff", "--name-only", base);
  }

  if (!output) {
    console.log("No changes detected.");
    return;
  }

  const files = output.split("\n").map((path) => ({ status: "", path }));
  const groups = groupByService(files);
  const services = Object.keys(groups).sort();

  console.log(services.join(" "));
}

async function commitCmd(
  positionals: string[],
  flags: Record<string, string>,
) {
  let service = positionals[0];
  let topic = flags["topic"];
  let message = flags["m"];
  const type = (flags["type"] ?? "feat") as (typeof COMMIT_TYPES)[number];

  if (!service) {
    const allServices = [...Object.values(SERVICES), "root"];
    service = await select("Select a service:", allServices);
  }

  if (!topic) {
    topic = await promptWithWordLimit("Topic (required):", 10);
    if (!topic) {
      console.error("Topic is required.");
      process.exit(1);
    }
  }

  if (message === undefined) {
    message = await prompt("Message (optional):");
  }
  if (!COMMIT_TYPES.includes(type)) {
    console.error(
      `Invalid type "${type}". Must be one of: ${COMMIT_TYPES.join(", ")}`,
    );
    process.exit(1);
  }

  const allServices = [...Object.values(SERVICES), "root"];
  if (!allServices.includes(service)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${allServices.join(", ")}`,
    );
    process.exit(1);
  }

  const branch = await getCurrentBranch();
  if (PROTECTED_BRANCHES.includes(branch)) {
    const slug = slugify(topic);
    const newBranch = `${service}/${type}/${slug}`;
    console.log(`On ${branch}, creating branch: \x1b[36m${newBranch}\x1b[0m`);
    await git("checkout", "-b", newBranch);
  }

  const serviceDir = service === "root" ? "." : service;
  const statusOutput = await git("status", "--porcelain");
  const files = parseStatusOutput(statusOutput);
  const serviceFiles = files.filter((f) => {
    if (service === "root") {
      return !Object.keys(SERVICES).some((prefix) =>
        f.path.startsWith(`${prefix}/`),
      );
    }
    return f.path.startsWith(`${serviceDir}/`);
  });

  if (serviceFiles.length === 0) {
    console.error(`No changed files in ${service}.`);
    process.exit(1);
  }

  for (const f of serviceFiles) {
    await git("add", f.path);
  }

  const subject =
    service === "root" ? `${type}: ${topic}` : `${type}(${service}): ${topic}`;
  const commitMsg = message?.trim() ? `${subject}\n\n${message.trim()}` : subject;

  await git("commit", "-m", commitMsg);
  console.log(`\x1b[32mCommitted:\x1b[0m ${subject}`);
  if (message) console.log(`  ${message}`);
  console.log(`  ${serviceFiles.length} file${serviceFiles.length !== 1 ? "s" : ""} staged`);
}

async function diffCmd(positionals: string[]) {
  const service = positionals[0];

  if (service) {
    const serviceDir = service === "root" ? "." : service;
    if (service === "root") {
      const output = await git("diff");
      const lines = output.split("\n");
      const filtered = lines.filter((line) => {
        if (line.startsWith("diff --git")) {
          const path = line.split(" b/")[1] ?? "";
          return !Object.keys(SERVICES).some((prefix) =>
            path.startsWith(`${prefix}/`),
          );
        }
        return true;
      });
      console.log(filtered.join("\n"));
    } else {
      const output = await git("diff", "--", `${serviceDir}/`);
      console.log(output);
    }
    return;
  }

  const output = await git("diff", "--stat");
  if (!output) {
    console.log("No unstaged changes.");
    return;
  }
  console.log(output);
}

async function runCmd(positionals: string[]) {
  const service = positionals[0];
  const script = positionals[1];

  if (!service || !script) {
    console.error("Usage: gb run <service> <script>");
    process.exit(1);
  }

  const allServices = Object.values(SERVICES);
  if (!allServices.includes(service)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${allServices.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\x1b[36m${service}\x1b[0m > bun run ${script}`);
  const proc = Bun.spawn(["bun", "run", script], {
    cwd: `${import.meta.dir}/../${service}`,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}

function helpCmd() {
  console.log(`
\x1b[1mgb\x1b[0m — monorepo git CLI

\x1b[1mCommands:\x1b[0m
  status                         Show git status grouped by service
  affected [--base=main]         List services with changes vs a base branch
  commit <service>                  Stage and commit files for a service
         [--topic "topic"]         Commit topic (prompted if omitted)
         [-m "message"]            Optional extended commit message
         [--type=feat]             Commit type (feat, fix, refactor, test, docs, chore, ci, perf)
  diff [service]                 Show diff for a service or all
  run <service> <script>         Run a package.json script in a service

\x1b[1mServices:\x1b[0m ${[...Object.values(SERVICES), "root"].join(", ")}

\x1b[1mExamples:\x1b[0m
  gb status
  gb affected --base=dev
  gb commit frontend
  gb commit frontend --topic "add auth" --type=feat
  gb commit frontend --topic "add auth" -m "supports OAuth and email"
  gb diff backend
  gb run backend test
`);
}

// --- Main ---

const { command, positionals, flags } = parseArgs(Bun.argv);

switch (command) {
  case "status":
    await statusCmd();
    break;
  case "affected":
    await affectedCmd(flags);
    break;
  case "commit":
    await commitCmd(positionals, flags);
    break;
  case "diff":
    await diffCmd(positionals);
    break;
  case "run":
    await runCmd(positionals);
    break;
  case "help":
  case "--help":
  case "-h":
    helpCmd();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    helpCmd();
    process.exit(1);
}
