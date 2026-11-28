#!/usr/bin/env bun
/**
 * manager/scripts/release.ts
 *
 * Usage:
 *   bun run release            — prompts: major / minor / patch, then tags + pushes
 *   bun run release --dry-run  — preview only, nothing is written or pushed
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import * as readline from "readline";

const dryRun = process.argv.includes("--dry-run");

// ── Helpers ───────────────────────────────────────────────────────────────────

const pkgPath = resolve(import.meta.dir, "../package.json");
const tauriConfPath = resolve(import.meta.dir, "../src-tauri/tauri.conf.json");

function readJson(p: string): Record<string, any> {
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeJson(p: string, data: Record<string, any>) {
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function log(msg: string) {
  console.log(msg);
}

async function run(cmd: string, label: string) {
  log(`  › ${label}`);
  if (dryRun) {
    log(`    [dry-run] skipping: ${cmd}`);
    return;
  }
  await $`bash -c ${cmd}`;
}

// ── Read current version ──────────────────────────────────────────────────────

const pkg = readJson(pkgPath);
const current = pkg.version as string;

log(`\n🚀 Gradebook Manager — Release`);
log(`   Current version : ${current}`);
if (dryRun) log(`   Mode            : DRY RUN\n`);
else log(``);

// ── Check working tree is clean ───────────────────────────────────────────────

const dirty = await $`git status --porcelain`.text();
if (dirty.trim()) {
  console.error("❌ Working tree is not clean. Commit or stash your changes first.");
  console.error(dirty);
  process.exit(1);
}

// ── Prompt for bump type ──────────────────────────────────────────────────────

log(`   What kind of release is this?`);
log(`     [1] patch  — bug fixes          (${bumpVersion(current, "patch")})`);
log(`     [2] minor  — new features       (${bumpVersion(current, "minor")})`);
log(`     [3] major  — breaking changes   (${bumpVersion(current, "major")})\n`);

let bumpType: "major" | "minor" | "patch";

while (true) {
  const answer = await prompt("   Enter 1 / 2 / 3  (or patch / minor / major): ");
  if (answer === "1" || answer === "patch") { bumpType = "patch"; break; }
  if (answer === "2" || answer === "minor") { bumpType = "minor"; break; }
  if (answer === "3" || answer === "major") { bumpType = "major"; break; }
  log("   ⚠️  Please enter 1, 2 or 3.");
}

const newVersion = bumpVersion(current, bumpType);
const tag = `manager-v${newVersion}`;

log(`\n   Bump   : ${current} → ${newVersion}  (${bumpType})`);
log(`   Tag    : ${tag}\n`);

// ── Confirm ───────────────────────────────────────────────────────────────────

const confirm = await prompt(`   Confirm? [y/N]: `);
if (!["y", "yes"].includes(confirm.toLowerCase())) {
  log("\n   Aborted.");
  process.exit(0);
}

// ── Check tag doesn't already exist ──────────────────────────────────────────

const existing = await $`git tag --list ${tag}`.text();
if (existing.trim()) {
  console.error(`\n❌ Tag "${tag}" already exists.`);
  process.exit(1);
}

// ── Bump versions in package.json + tauri.conf.json ──────────────────────────

log(`\n  › Bumping package.json  ${current} → ${newVersion}`);
if (!dryRun) {
  pkg.version = newVersion;
  writeJson(pkgPath, pkg);
}

// Also keep tauri.conf.json in sync if it has a version field
try {
  const tauriConf = readJson(tauriConfPath);
  if (tauriConf.version) {
    log(`  › Bumping tauri.conf.json  ${tauriConf.version} → ${newVersion}`);
    if (!dryRun) {
      tauriConf.version = newVersion;
      writeJson(tauriConfPath, tauriConf);
    }
  }
} catch {
  // tauri.conf.json may not exist yet or have no version field — that's fine
}

// ── Commit version bump ───────────────────────────────────────────────────────

await run(
  `git add manager/package.json manager/src-tauri/tauri.conf.json && git commit -m "chore(manager): bump version to ${newVersion}"`,
  `Commit version bump`,
);

// ── Tag & push ────────────────────────────────────────────────────────────────

await run(
  `git tag -a "${tag}" -m "Gradebook Manager ${newVersion}"`,
  `Create annotated tag ${tag}`,
);
await run(
  `git push origin HEAD "${tag}"`,
  `Push commit + tag → triggers GitHub Actions build & release`,
);

// ── Done ──────────────────────────────────────────────────────────────────────

if (dryRun) {
  log(`\n✅ Dry run complete. No files were modified and nothing was pushed.`);
} else {
  log(`\n✅ Released manager-v${newVersion}!`);
  log(`   GitHub Actions is now building macOS / Linux / Windows installers.`);
  log(`   Watch: https://github.com/daulric-dev/gb/actions\n`);
}
