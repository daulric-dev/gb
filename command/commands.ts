import { readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { SERVICES, ALL_SERVICES, NORMALIZED_SERVICES, CONFIGURED_ROOT, COMMIT_TYPES, PROTECTED_BRANCHES, type CommitType } from "./constants";
import { git, getCurrentBranch, groupByService, parseStatusOutput, slugify } from "./utils";
import { prompt, promptPrefilled, promptWithWordLimit, select } from "./prompts";

const MR_CONFIG_PATH = join(import.meta.dir, "../_mr.json");

type ServiceEntry = string | {
  name: string;
  paths: string[];
};

interface NormalizedService {
  name: string;
  paths: string[]
}

interface MrConfig {
  root?: string;
  services: ServiceEntry[];
  protectedBranches?: string[];
}

function normalizedEntry(entry: ServiceEntry): NormalizedService {
  return typeof entry === "string" ? { name: entry, paths: [entry] } : entry;
}

function readMrConfig(): MrConfig {
  return JSON.parse(readFileSync(MR_CONFIG_PATH, "utf-8")) as MrConfig;
}

function writeMrConfig(config: MrConfig): void {
  writeFileSync(MR_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export async function serviceCmd(positionals: string[]) {
  const sub = positionals[0];

  if (!sub || sub === "list") {
    const entries = readMrConfig().services.map(normalizedEntry);

    const statusOutput = await git("status", "--porcelain");
    const files = parseStatusOutput(statusOutput);
    const groups = files.length > 0 ? groupByService(files) : {};

    console.log("\x1b[1mRegistered services:\x1b[0m");
    for (const { name, paths } of entries) {
      const count = groups[name]?.length ?? 0;
      const indicator = count > 0
        ? `  \x1b[33m● ${count} change${count !== 1 ? "s" : ""}\x1b[0m`
        : "";
      console.log(`  \x1b[36m${name}\x1b[0m  \x1b[2m→ ${paths.join(", ")}\x1b[0m${indicator}`);
    }
    const rootCount = groups["root"]?.length ?? 0;
    const rootIndicator = rootCount > 0
      ? `  \x1b[33m● ${rootCount} change${rootCount !== 1 ? "s" : ""}\x1b[0m`
      : "";
    console.log(`  \x1b[2mroot  → (built-in - catches unregistered paths)\x1b[0m${rootIndicator}`);
    return;
  }

  if (sub === "add") {
    const name = await promptPrefilled("Service name:", positionals[1] ?? "");
    if (!name) {
      console.error("Service name is required.");
      process.exit(1);
    }
    if (name === "root") {
      console.error("root is a built-in service and cannot be added.");
      process.exit(1);
    }
    const config = readMrConfig();
    if (config.services.map(normalizedEntry).some((e) => e.name === name)) {
      console.log(`\x1b[33m${name}\x1b[0m is already registered.`);
      return;
    }
    const rawPaths = await promptPrefilled("Paths (comma-separated):", name);
    const paths = rawPaths.trim()
      ? rawPaths.split(",").map((p) => p.trim()).filter(Boolean)
      : [name];
    config.services.push({ name, paths });
    writeMrConfig(config);
    console.log(`\x1b[32mAdded\x1b[0m \x1b[36m${name}\x1b[0m → ${paths.join(", ")}`);
    return;
  }

  if (sub === "edit") {
    const config = readMrConfig();
    const entries = config.services.map(normalizedEntry);
    if (entries.length === 0) {
      console.log("No services registered.");
      return;
    }
    const name = await select("Edit which service?", entries.map((e) => e.name));
    const current = entries.find((e) => e.name === name)!;
    const rawPaths = await promptPrefilled("Paths (comma-separated):", current.paths.join(", "));
    const paths = rawPaths.trim()
      ? rawPaths.split(",").map((p) => p.trim()).filter(Boolean)
      : current.paths;
    config.services = config.services.map((s) =>
      normalizedEntry(s).name === name ? { name, paths } : s,
    );
    writeMrConfig(config);
    console.log(`\x1b[32mUpdated\x1b[0m \x1b[36m${name}\x1b[0m → ${paths.join(", ")}`);
    return;
  }

  if (sub === "remove") {
    const config = readMrConfig();
    const entries = config.services.map(normalizedEntry);
    if (entries.length === 0) {
      console.log("No services registered.");
      return;
    }
    let name = positionals[1];
    if (!name) {
      name = await select("Remove which service?", entries.map((e) => e.name));
    }
    if (name === "root") {
      console.error("root is a built-in service and cannot be removed.");
      process.exit(1);
    }
    if (!entries.some((e) => e.name === name)) {
      console.error(`Service "${name}" is not registered.`);
      process.exit(1);
    }
    config.services = config.services.filter((s) => normalizedEntry(s).name !== name);
    writeMrConfig(config);
    console.log(`\x1b[32mRemoved\x1b[0m \x1b[36m${name}\x1b[0m from _mr.json`);
    return;
  }

  if (sub === "root") {
    const config = readMrConfig();
    const action = positionals[1];

    if (!action || action === "show") {
      if (config.root) {
        console.log(`\x1b[1mConfigured root:\x1b[0m \x1b[36m${config.root}\x1b[0m`);
      } else {
        const detected = await git("rev-parse", "--show-toplevel");
        console.log(`\x1b[1mRoot:\x1b[0m \x1b[36m${detected}\x1b[0m \x1b[2m(detected from git)\x1b[0m`);
      }
      return;
    }

    if (action === "set") {
      const current = config.root ?? await git("rev-parse", "--show-toplevel");
      const newRoot = await promptPrefilled("Monorepo root path:", current);
      if (!newRoot) {
        console.error("Root path is required.");
        process.exit(1);
      }
      config.root = newRoot;
      writeMrConfig(config);
      console.log(`\x1b[32mUpdated root\x1b[0m → \x1b[36m${newRoot}\x1b[0m`);
      return;
    }

    if (action === "clear") {
      delete config.root;
      writeMrConfig(config);
      console.log(`\x1b[32mCleared root override\x1b[0m - will use git detection`);
      return;
    }

    console.error(`Unknown action: service root ${action}`);
    console.error("Usage: gb service root [show|set|clear]");
    process.exit(1);
  }

  console.error(`Unknown subcommand: service ${sub}`);
  console.error("Usage: gb service [list|add|edit|remove|root]");
  process.exit(1);
}

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
  let isFirst = true;
  let branchCreated = false;

  const gitRoot = await git("rev-parse", "--show-toplevel");
  const rootPrefix = CONFIGURED_ROOT && CONFIGURED_ROOT !== gitRoot
    ? relative(gitRoot, CONFIGURED_ROOT)
    : "";

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

    const currentFiles = parseStatusOutput(statusCheck);
    const currentGroups = groupByService(currentFiles);
    const currentServices = Object.keys(currentGroups).sort();

    if (currentServices.length === 0) {
      console.log("\x1b[32mNo more changes to commit.\x1b[0m");
      break;
    }

    if (isFirst) {
      console.log(`\x1b[1mChanges detected:\x1b[0m`);
      for (const svc of currentServices) {
        const count = currentGroups[svc]?.length ?? 0;
        console.log(`  \x1b[33m●\x1b[0m \x1b[36m${svc}\x1b[0m  ${count} change${count !== 1 ? "s" : ""}`);
      }
      console.log();
    } else {
      console.log();
      console.log(`\x1b[1mRemaining changes:\x1b[0m`);
      for (const svc of currentServices) {
        const count = currentGroups[svc]?.length ?? 0;
        console.log(`  \x1b[33m●\x1b[0m \x1b[36m${svc}\x1b[0m  ${count} change${count !== 1 ? "s" : ""}`);
      }
      console.log();

      const continueOptions = ["yes", "no"];
      const shouldContinue = await select("Commit another service?", continueOptions);
      if (shouldContinue === "no") break;
    }

    if (!service) {
      service = await select("Select a service:", ALL_SERVICES);
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

    if (!ALL_SERVICES.includes(service)) {
      console.error(
        `Unknown service "${service}". Must be one of: ${ALL_SERVICES.join(", ")}`,
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

    const statusOutput = await git("status", "--porcelain");
    const files = parseStatusOutput(statusOutput);
    const servicePaths = service === "root"
      ? null
      : (NORMALIZED_SERVICES.find((s) => s.name === service)?.paths ?? [service]);

    const withPrefix = (p: string) => rootPrefix ? `${rootPrefix}/${p}` : p;

    const serviceFiles = files.filter((f) => {
      if (service === "root") {
        return !Object.keys(SERVICES).some((prefix) =>
          f.path.startsWith(`${withPrefix(prefix)}/`),
        );
      }
      return servicePaths!.some((p) => f.path.startsWith(`${withPrefix(p)}/`));
    });

    if (serviceFiles.length === 0) {
      console.log(`\x1b[33mNo changed files in ${service}.\x1b[0m`);
      isFirst = false;
      continue;
    }

    for (const f of serviceFiles) {
      const stagePath = rootPrefix ? f.path.slice(rootPrefix.length + 1) : f.path;
      await git("add", stagePath);
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
    const options = ["custom", ...ALL_SERVICES];
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

  if (!ALL_SERVICES.includes(service!)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${ALL_SERVICES.join(", ")}`,
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

  if (!ALL_SERVICES.includes(service)) {
    console.error(
      `Unknown service "${service}". Must be one of: ${ALL_SERVICES.join(", ")}`,
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

export async function checkoutCmd(positionals: string[]) {
  console.log("Fetching remote refs...");
  await git("fetch", "--prune", "origin");

  const localOut = await git("branch", "--format=%(refname:short)");
  const remoteOut = await git("branch", "-r", "--format=%(refname:short)");

  const current = await getCurrentBranch();
  const local = new Set(localOut.split("\n").filter(Boolean));
  const remote = remoteOut
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/^origin\//, ""))
    .filter((b) => b !== "HEAD" && !local.has(b));

  const branches = [
    ...[...local].filter((b) => b !== current).map((b) => `  ${b}`),
    ...remote.map((b) => `↓ ${b}`),
  ].sort((a, b) => a.slice(2).localeCompare(b.slice(2)));

  if (branches.length === 0) {
    console.log("No other branches available.");
    return;
  }

  let target = positionals[0];
  if (!target) {
    const chosen = await select("Checkout branch:", branches);
    target = chosen.slice(2);
  }

  const isRemoteOnly = !local.has(target);
  if (isRemoteOnly) {
    await git("checkout", "-b", target, "--track", `origin/${target}`);
  } else {
    await git("checkout", target);
  }

  try {
    await git("pull", "origin", target);
    console.log(`\x1b[32mSwitched to\x1b[0m ${target} and pulled latest changes.`);
  } catch {
    console.log(`\x1b[32mSwitched to\x1b[0m ${target}.`);
    console.log(`\x1b[33mCould not pull - try manually if needed.\x1b[0m`);
  }
}

export async function syncCmd() {
  console.log("Fetching remote refs...");
  await git("fetch", "--prune", "origin");

  const current = await getCurrentBranch();
  let hasUpstream = false;
  try {
    await git("rev-parse", "--abbrev-ref", `${current}@{upstream}`);
    hasUpstream = true;
  } catch {
    // no upstream set
  }

  if (hasUpstream) {
    try {
      await git("merge", "--ff-only", `origin/${current}`);
      console.log(`\x1b[32mPulled latest changes into\x1b[0m ${current}.`);
    } catch {
      console.log(`\x1b[33mCould not fast-forward ${current} - diverged from remote?\x1b[0m`);
    }
  }

  const vv = await git("branch", "-vv");
  const gone = vv
    .split("\n")
    .filter((line) => line.includes(": gone]"))
    .map((line) => line.replace(/^\*?\s+/, "").split(/\s+/)[0] ?? "")
    .filter(Boolean);

  if (gone.length === 0) {
    console.log("\x1b[32mAll local branches have a remote counterpart.\x1b[0m");
    return;
  }

  console.log(`\x1b[33mLocal branches with no remote counterpart:\x1b[0m`);
  for (const b of gone) {
    console.log(`  \x1b[36m${b}\x1b[0m`);
  }
  console.log();

  const answer = await select(`Delete ${gone.length} branch(es)?`, ["yes", "no"]);
  if (answer === "no") {
    console.log("Aborted.");
    return;
  }

  for (const b of gone) {
    if (b === current) {
      console.log(`\x1b[33mSkipping \x1b[36m${b}\x1b[33m (currently checked out).\x1b[0m`);
      continue;
    }
    await git("branch", "-D", b);
    console.log(`\x1b[32mDeleted\x1b[0m ${b}`);
  }
}

export async function rebaseCmd(flags: Record<string, string>) {
  console.log("Fetching remote refs...");
  await git("fetch", "--prune", "origin");

  const current = await getCurrentBranch();
  const localOut = await git("branch", "--format=%(refname:short)");
  const remoteOut = await git("branch", "-r", "--format=%(refname:short)");

  const local = new Set(localOut.split("\n").filter(Boolean));
  const remote = remoteOut
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/^origin\//, ""))
    .filter((b) => b !== "HEAD");

  const allBranches = [...new Set([...local, ...remote])].sort();

  let source = flags["from"];
  if (!source) {
    const sourceOptions = allBranches.map((b) => b === current ? `* ${b}` : `  ${b}`);
    const chosen = await select("Branch to rebase:", sourceOptions);
    source = chosen.slice(2);
  }

  let base = flags["base"];
  if (!base) {
    const baseOptions = allBranches.filter((b) => b !== source).map((b) => `  ${b}`);
    const chosen = await select(`Rebase ${source} onto:`, baseOptions);
    base = chosen.slice(2);
  }

  if (source === base) {
    console.error(`\x1b[31mSource and base cannot be the same branch.\x1b[0m`);
    process.exit(1);
  }

  const sourceRef = local.has(source) ? source : `origin/${source}`;
  const baseRef = `origin/${base}`;

  const behind = (await git("rev-list", "--count", `${sourceRef}..${baseRef}`)).trim();
  const ahead = (await git("rev-list", "--count", `${baseRef}..${sourceRef}`)).trim();

  console.log(
    `\x1b[36m${source}\x1b[0m is \x1b[33m${behind}\x1b[0m commit${behind === "1" ? "" : "s"} behind` +
    ` and \x1b[33m${ahead}\x1b[0m commit${ahead === "1" ? "" : "s"} ahead of \x1b[36m${base}\x1b[0m`,
  );

  if (behind === "0") {
    console.log(`\x1b[32m${source} is already up to date with ${base}.\x1b[0m`);
    return;
  }

  const answer = await select(`Rebase ${source} onto ${base}?`, ["yes", "no"]);
  if (answer === "no") {
    console.log("Aborted.");
    return;
  }

  if (current !== source) {
    await git("checkout", source);
    console.log(`\x1b[32mSwitched to\x1b[0m ${source}`);
  }

  try {
    await git("rebase", baseRef);
    console.log(`\x1b[32mRebased\x1b[0m ${source} onto ${base}.`);
  } catch {
    console.error(`\x1b[31mRebase failed - you may have conflicts.\x1b[0m`);
    console.error(`Resolve them, then run: git rebase --continue`);
    console.error(`Or abort with: git rebase --abort`);
    process.exit(1);
  }

  const pushAnswer = await select("Force-push to update remote?", ["yes", "no"]);
  if (pushAnswer === "yes") {
    await git("push", "--force-with-lease");
    console.log(`\x1b[32mPushed\x1b[0m ${source} to origin (force-with-lease)`);
  }
}

export async function resetCmd() {
  const current = await getCurrentBranch();

  let hasUpstream = false;
  try {
    await git("rev-parse", "--abbrev-ref", `${current}@{upstream}`);
    hasUpstream = true;
  } catch {}

  if (!hasUpstream) {
    console.error(`\x1b[31m${current} has no remote tracking branch.\x1b[0m`);
    process.exit(1);
  }

  console.log("Fetching remote refs...");
  await git("fetch", "origin");

  const local = (await git("rev-parse", current)).trim();
  const remote = (await git("rev-parse", `origin/${current}`)).trim();

  if (local === remote) {
    console.log(`\x1b[32m${current} is already in sync with origin/${current}.\x1b[0m`);
    return;
  }

  const behind = (await git("rev-list", "--count", `${current}..origin/${current}`)).trim();
  const ahead = (await git("rev-list", "--count", `origin/${current}..${current}`)).trim();

  console.log(
    `\x1b[36m${current}\x1b[0m is \x1b[33m${behind}\x1b[0m behind, \x1b[33m${ahead}\x1b[0m ahead of \x1b[36morigin/${current}\x1b[0m`,
  );

  const answer = await select(`Reset ${current} to match origin/${current}? (local changes will be lost)`, ["yes", "no"]);
  if (answer === "no") {
    console.log("Aborted.");
    return;
  }

  await git("reset", "--hard", `origin/${current}`);
  console.log(`\x1b[32mReset\x1b[0m ${current} to origin/${current}`);
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

  lines.push(`\n\x1b[1mServices:\x1b[0m ${ALL_SERVICES.join(", ")}\n`);

  lines.push(`\x1b[1mExamples:\x1b[0m`);
  for (const example of help.examples) {
    lines.push(`  ${example}`);
  }

  console.log(lines.join("\n") + "\n");
}
