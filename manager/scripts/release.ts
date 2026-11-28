#!/usr/bin/env bun
/**
 * manager/scripts/release.ts
 *
 * Usage:
 *   bun run release                  — tags + pushes manager-v<version from package.json>
 *   bun run release --version 0.2.0  — overrides version
 *   bun run release --dry-run        — prints what it would do, nothing is pushed
 */

import { $ } from "bun";
import pkg from "../package.json";

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const versionFlag = args.indexOf("--version");
const version =
  versionFlag !== -1 && args[versionFlag + 1]
    ? args[versionFlag + 1]
    : pkg.version;

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`❌ Invalid version: "${version}". Expected semver like 1.2.3`);
  process.exit(1);
}

const tag = `manager-v${version}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(msg);
}

async function run(cmd: string, label: string) {
  log(`  › ${label}`);
  if (dryRun) {
    log(`    [dry-run] would run: ${cmd}`);
    return;
  }
  await $`bash -c ${cmd}`;
}

// ── Checks ────────────────────────────────────────────────────────────────────

log(`\n🚀 Gradebook Manager Release`);
log(`   Version : ${version}`);
log(`   Tag     : ${tag}`);
if (dryRun) log(`   Mode    : DRY RUN — nothing will be pushed\n`);
else log(``);

// Abort if the working tree is dirty
const status = await $`git status --porcelain`.text();
if (status.trim()) {
  console.error("❌ Working tree is not clean. Commit or stash your changes first.");
  console.error(status);
  process.exit(1);
}

// Warn if the tag already exists
const existingTags = await $`git tag --list ${tag}`.text();
if (existingTags.trim()) {
  console.error(`❌ Tag "${tag}" already exists. Bump the version in manager/package.json first.`);
  process.exit(1);
}

// ── Release ───────────────────────────────────────────────────────────────────

await run(`git tag -a "${tag}" -m "Gradebook Manager ${version}"`, `Create annotated tag ${tag}`);
await run(`git push origin "${tag}"`, `Push tag → triggers GitHub Actions build & release`);

if (dryRun) {
  log(`\n✅ Dry run complete. No changes made.`);
} else {
  log(`\n✅ Tag "${tag}" pushed.`);
  log(`   GitHub Actions will now build macOS / Linux / Windows and attach`);
  log(`   the installers to the GitHub Release automatically.`);
  log(`   Watch progress at: https://github.com/daulric-dev/gb/actions\n`);
}
