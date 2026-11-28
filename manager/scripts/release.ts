#!/usr/bin/env bun
/**
 * Cut a manager release: `bun release <major|minor|patch> [--dry-run] [--yes]`
 *
 * Finds the latest `manager-vX.Y.Z` tag (none yet = 0.0.0), bumps the chosen
 * part, writes the new version to package.json + tauri.conf.json, commits,
 * creates an annotated tag and pushes. The push triggers
 * .github/workflows/manager-release.yml, which builds macOS / Linux / Windows
 * installers and publishes the GitHub Release.
 *
 * Refuses unless the working tree is clean, you are on `main` and `main`
 * matches `origin/main`.
 *
 *   --dry-run  show what would happen; write and tag nothing
 *   --yes      skip the confirmation prompt
 */
import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const RELEASE_BRANCH = "main";
const REMOTE = "origin";
const BUMPS = ["major", "minor", "patch"] as const;
type Bump = (typeof BUMPS)[number];

const pkgPath = resolve(import.meta.dir, "../package.json");
const tauriConfPath = resolve(import.meta.dir, "../src-tauri/tauri.conf.json");

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

function usage(): never {
  console.error("Usage: bun release <major|minor|patch> [--dry-run] [--yes]");
  process.exit(1);
}

type Version = [number, number, number];

function parse(tag: string): Version | null {
  const m = /^manager-v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function bump([major, minor, patch]: Version, part: Bump): Version {
  if (part === "major") return [major + 1, 0, 0];
  if (part === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

const format = (v: Version) => v.join(".");

async function git(args: string[]): Promise<string> {
  const res = await $`git ${args}`.quiet().nothrow();
  if (res.exitCode !== 0) {
    fail(`git ${args.join(" ")} failed:\n${res.stderr.toString().trim()}`);
  }
  return res.stdout.toString().trim();
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);
  for await (const line of console) {
    return /^y(es)?$/i.test(line.trim());
  }
  return false;
}

function readJson(p: string): Record<string, any> {
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeJson(p: string, data: Record<string, any>) {
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const part = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
if (!part || !BUMPS.includes(part as Bump)) usage();

// ── Git checks ────────────────────────────────────────────────────────────────

if (await git(["status", "--porcelain"])) {
  fail("the working tree has uncommitted changes; commit or stash them first.");
}
const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== RELEASE_BRANCH) {
  fail(`releases are cut from ${RELEASE_BRANCH}; you are on ${branch}.`);
}
await git(["fetch", REMOTE, RELEASE_BRANCH, "--tags", "--quiet"]);
const head = await git(["rev-parse", "HEAD"]);
const remoteHead = await git(["rev-parse", `${REMOTE}/${RELEASE_BRANCH}`]);
if (head !== remoteHead) {
  fail(`${RELEASE_BRANCH} differs from ${REMOTE}/${RELEASE_BRANCH}; pull or push first.`);
}

// ── Version ───────────────────────────────────────────────────────────────────

const tags = (await git(["tag", "--list", "manager-v*.*.*"])).split("\n").filter(Boolean);
const current = tags
  .map(parse)
  .filter((v): v is Version => v !== null)
  .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? ([0, 0, 0] as Version);

const next = bump(current, part as Bump);
const tag = `manager-v${format(next)}`;
if (tags.includes(tag)) fail(`${tag} already exists.`);

const short = head.slice(0, 7);
console.log(`Latest release: ${tags.length ? `manager-v${format(current)}` : "none"}`);
console.log(`Next release:   ${tag} (${part}) at ${short} on ${RELEASE_BRANCH}`);

if (dryRun) {
  console.log("Dry run: nothing was tagged or pushed.");
  process.exit(0);
}
if (!yes && !(await confirm(`Tag ${short} as ${tag} and push it to ${REMOTE}?`))) {
  console.log("Cancelled.");
  process.exit(0);
}

// ── Bump version files ────────────────────────────────────────────────────────

const newVersion = format(next);

const pkg = readJson(pkgPath);
pkg.version = newVersion;
writeJson(pkgPath, pkg);

try {
  const tauriConf = readJson(tauriConfPath);
  if ("version" in tauriConf) {
    tauriConf.version = newVersion;
    writeJson(tauriConfPath, tauriConf);
  }
} catch {
  // tauri.conf.json missing or unversioned — skip silently
}

await $`git add manager/package.json manager/src-tauri/tauri.conf.json`.quiet();
await $`git commit -m ${"chore(manager): bump version to " + newVersion}`.quiet();

// ── Tag & push ────────────────────────────────────────────────────────────────

await git(["tag", "-a", tag, "-m", `Gradebook Manager ${newVersion}`]);
const pushed = await $`git push ${REMOTE} HEAD ${tag}`.nothrow();
if (pushed.exitCode !== 0) {
  await $`git tag -d ${tag}`.quiet().nothrow();
  await $`git reset --soft HEAD~1`.quiet().nothrow();
  fail(`pushing ${tag} failed; the local tag and commit were removed.`);
}

console.log(`\nPushed ${tag}. The manager release workflow builds and publishes it:`);
console.log("  Actions tab -> Gradebook Manager - Build & Release, then the repo's Releases page.");
