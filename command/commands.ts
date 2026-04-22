import { SERVICES, COMMIT_TYPES, PROTECTED_BRANCHES, type CommitType } from "./constants";
import { git, getCurrentBranch, groupByService, parseStatusOutput, slugify } from "./utils";
import { prompt, promptWithWordLimit, select } from "./prompts";

export async function statusCmd() {
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

export async function affectedCmd(flags: Record<string, string>) {
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

export async function commitCmd(
  positionals: string[],
  flags: Record<string, string>,
) {
  let service = positionals[0];
  let topic = flags["topic"];
  let message = flags["m"];
  const type = (flags["type"] ?? "feat") as CommitType;

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
    const newBranch = `${type}(${service})/${slug}`;
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

export async function branchCmd(
  positionals: string[],
  flags: Record<string, string>,
) {
  let service = positionals[0];
  let name = positionals[1] ?? flags["name"];
  const type = flags["type"];

  if (!service) {
    const allServices = [...Object.values(SERVICES), "root"];
    service = await select("Select a service:", allServices);
  }

  const allServices = [...Object.values(SERVICES), "root"];
  if (!allServices.includes(service)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${allServices.join(", ")}`,
    );
    process.exit(1);
  }

  if (!name) {
    name = await prompt("Branch name:");
    if (!name) {
      console.error("Branch name is required.");
      process.exit(1);
    }
  }

  const slug = slugify(name);
  const branchName = type
    ? `${type}(${service})/${slug}`
    : `${service}/${slug}`;

  await git("checkout", "-b", branchName);
  console.log(`\x1b[32mCreated and switched to:\x1b[0m \x1b[36m${branchName}\x1b[0m`);
}

export async function diffCmd(positionals: string[]) {
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

export async function runCmd(positionals: string[]) {
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

export async function pushCmd(flags: Record<string, string>) {
  const branch = await getCurrentBranch();
  const force = "force" in flags;

  let hasUpstream = true;
  try {
    await git("rev-parse", "--abbrev-ref", `${branch}@{upstream}`);
  } catch {
    hasUpstream = false;
  }

  const args = hasUpstream
    ? ["push", ...(force ? ["--force-with-lease"] : [])]
    : ["push", "-u", "origin", branch];

  console.log(`\x1b[36m${branch}\x1b[0m > git ${args.join(" ")}`);
  await git(...args);
  console.log(`\x1b[32mPushed\x1b[0m ${branch} to origin`);
}

export function helpCmd() {
  console.log(`
\x1b[1mgb\x1b[0m — monorepo git CLI

\x1b[1mCommands:\x1b[0m
  status                         Show git status grouped by service
  affected [--base=main]         List services with changes vs a base branch
  branch [service] [name]        Create a service-scoped branch
         [--type=feat]             Optional type prefix (e.g. feat, fix)
  commit [service]               Stage and commit files for a service
         [--topic "topic"]         Commit topic (prompted if omitted)
         [-m "message"]            Optional extended commit message
         [--type=feat]             Commit type (feat, fix, refactor, test, docs, chore, ci, perf)
  diff [service]                 Show diff for a service or all
  push [--force]                 Push current branch to origin
  run <service> <script>         Run a package.json script in a service

\x1b[1mServices:\x1b[0m ${[...Object.values(SERVICES), "root"].join(", ")}

\x1b[1mExamples:\x1b[0m
  gb status
  gb affected --base=dev
  gb branch
  gb branch frontend "add auth" --type=feat
  gb commit frontend
  gb commit frontend --topic "add auth" --type=feat
  gb commit frontend --topic "add auth" -m "supports OAuth and email"
  gb diff backend
  gb push
  gb push --force
  gb run backend test
`);
}
