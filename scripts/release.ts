#!/usr/bin/env bun
/**
 * Cut a release: `bun release <major|minor|patch> [--dry-run] [--yes]`.
 *
 * Finds the latest `vX.Y.Z` tag (pre-releases ignored; none yet = 0.0.0),
 * bumps the chosen part, then creates an annotated tag on the current commit
 * and pushes it. The push triggers .github/workflows/release.yml, which
 * builds gradebook-<version>.zip and publishes the GitHub Release.
 *
 * Refuses unless the working tree is clean, you are on `main` and `main`
 * matches `origin/main`, so a release is always a commit everyone can see.
 *
 *   --dry-run  show what would happen; tag nothing
 *   --yes      skip the confirmation prompt
 */
import { $ } from "bun";

const RELEASE_BRANCH = "main";
const REMOTE = "origin";
const BUMPS = ["major", "minor", "patch"] as const;
type Bump = (typeof BUMPS)[number];

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
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
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

const args = process.argv.slice(2);
const part = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
if (!part || !BUMPS.includes(part as Bump)) usage();

// Only release what is on main and already pushed.
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

// Latest stable tag; pre-release tags (v1.2.0-beta.1) are skipped.
const tags = (await git(["tag", "--list", "v*.*.*"])).split("\n").filter(Boolean);
const current = tags
  .map(parse)
  .filter((v): v is Version => v !== null)
  .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? ([0, 0, 0] as Version);

const next = bump(current, part as Bump);
const tag = `v${format(next)}`;
if (tags.includes(tag)) fail(`${tag} already exists.`);

const short = head.slice(0, 7);
console.log(`Latest release: ${tags.length ? `v${format(current)}` : "none"}`);
console.log(`Next release:   ${tag} (${part}) at ${short} on ${RELEASE_BRANCH}`);

if (dryRun) {
  console.log("Dry run: nothing was tagged or pushed.");
  process.exit(0);
}
if (!yes && !(await confirm(`Tag ${short} as ${tag} and push it to ${REMOTE}?`))) {
  console.log("Cancelled.");
  process.exit(0);
}

await git(["tag", "-a", tag, "-m", `GradeBook ${format(next)}`]);
const pushed = await $`git push ${REMOTE} ${tag}`.nothrow();
if (pushed.exitCode !== 0) {
  // Don't leave a local tag that never reached the remote.
  await $`git tag -d ${tag}`.quiet().nothrow();
  fail(`pushing ${tag} failed; the local tag was removed.`);
}

console.log(`\nPushed ${tag}. The Release workflow builds and publishes it:`);
console.log("  Actions tab -> Release, then the repo's Releases page.");
