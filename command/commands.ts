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
  const allServices = [...Object.values(SERVICES), "root"];
  let isFirst = true;
  let branchCreated = false;

  while (true) {
    let service = isFirst ? positionals[0] : undefined;
    let topic = isFirst ? flags["topic"] : undefined;
    let message = isFirst ? flags["m"] : undefined;
    const type = (isFirst ? flags["type"] ?? "feat" : "feat") as CommitType;

    const statusCheck = await git("status", "--porcelain");
    if (!statusCheck.trim()) {
      console.log("\x1b[32mNo more changes to commit.\x1b[0m");
      break;
    }

    if (!isFirst) {
      console.log();
      const remaining = parseStatusOutput(statusCheck);
      const groups = groupByService(remaining);
      const availableServices = Object.keys(groups).sort();

      if (availableServices.length === 0) {
        console.log("\x1b[32mNo more changes to commit.\x1b[0m");
        break;
      }

      console.log(`\x1b[1mRemaining changes:\x1b[0m`);
      for (const svc of availableServices) {
        console.log(`  \x1b[36m${svc}\x1b[0m (${groups[svc].length} file${groups[svc].length !== 1 ? "s" : ""})`);
      }
      console.log();

      const continueOptions = ["yes", "no"];
      const shouldContinue = await select("Commit another service?", continueOptions);
      if (shouldContinue === "no") break;
    }

    if (!service) {
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

    if (!allServices.includes(service)) {
      console.error(
        `Unknown service "${service}". Must be one of: ${allServices.join(", ")}`,
      );
      process.exit(1);
    }

    if (!branchCreated) {
      const branch = await getCurrentBranch();
      if (PROTECTED_BRANCHES.includes(branch)) {
        const slug = slugify(topic);
        const newBranch = `${type}(${service})/${slug}`;
        console.log(`On ${branch}, creating branch: \x1b[36m${newBranch}\x1b[0m`);
        await git("checkout", "-b", newBranch);
        branchCreated = true;
      }
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
      console.log(`\x1b[33mNo changed files in ${service}.\x1b[0m`);
      isFirst = false;
      continue;
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

    isFirst = false;
  }
}

export async function branchCmd(
  positionals: string[],
  flags: Record<string, string>,
) {
  const currentBranch = await getCurrentBranch();
  if (!PROTECTED_BRANCHES.includes(currentBranch)) {
    console.warn(
      `\x1b[33mWarning:\x1b[0m You are on \x1b[36m${currentBranch}\x1b[0m, which is not a protected branch.`,
    );
    const answer = await select("Continue creating a new branch?", ["yes", "no"]);
    if (answer === "no") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  let service = positionals[0];
  let name = positionals[1] ?? flags["name"];
  let type: string | undefined = flags["type"];
  const isCustom = "custom" in flags;

  if (!service && !isCustom) {
    const options = ["custom", ...Object.values(SERVICES), "root"];
    const selected = await select("Select a service:", options);
    if (selected === "custom") {
      let customName = await prompt("Branch name:");
      if (!customName) {
        console.error("Branch name is required.");
        process.exit(1);
      }
      const branchName = slugify(customName);
      await git("checkout", "-b", branchName);
      console.log(`\x1b[32mCreated and switched to:\x1b[0m \x1b[36m${branchName}\x1b[0m`);
      return;
    }
    service = selected;
  }

  if (isCustom) {
    let customName = name ?? await prompt("Branch name:");
    if (!customName) {
      console.error("Branch name is required.");
      process.exit(1);
    }
    const branchName = slugify(customName);
    await git("checkout", "-b", branchName);
    console.log(`\x1b[32mCreated and switched to:\x1b[0m \x1b[36m${branchName}\x1b[0m`);
    return;
  }

  const allServices = [...Object.values(SERVICES), "root"];
  if (!allServices.includes(service!)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${allServices.join(", ")}`,
    );
    process.exit(1);
  }

  if (!type) {
    const typeOptions = ["skip", ...COMMIT_TYPES];
    const selected = await select("Select a type:", typeOptions);
    type = selected === "skip" ? undefined : selected;
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
    : `${service}(${slug})`;

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
  const help = JSON.parse(
    require("fs").readFileSync(`${import.meta.dir}/help.json`, "utf-8"),
  );

  const COL = 35;
  const lines: string[] = [];

  lines.push(`\n\x1b[1m${help.name}\x1b[0m - ${help.description}\n`);

  lines.push(`\x1b[1mCommands:\x1b[0m`);
  for (const cmd of help.commands) {
    const label = cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
    lines.push(`  ${label.padEnd(COL)}${cmd.description}`);
    if (cmd.options) {
      for (const opt of cmd.options) {
        lines.push(`  ${"".padEnd(cmd.name.length)}${opt.flag.padEnd(COL - cmd.name.length)}${opt.description}`);
      }
    }
  }

  lines.push(`\n\x1b[1mServices:\x1b[0m ${[...Object.values(SERVICES), "root"].join(", ")}\n`);

  lines.push(`\x1b[1mExamples:\x1b[0m`);
  for (const example of help.examples) {
    lines.push(`  ${example}`);
  }

  console.log(lines.join("\n") + "\n");
}
