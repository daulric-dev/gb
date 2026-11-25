#!/usr/bin/env bash
# Packages the frontend, backend and docs sources, the self-hosting files in
# infrastructure/ and the root workspace files into gradebook-<VERSION>.zip
# and writes its checksum to SHA256SUMS, both in the current directory (the
# repo root).
#
# Called by: .github/workflows/release.yml, job "package", step "Build zip".
# Env:       VERSION - resolved version from release-resolve-version.sh
# Outputs:   gradebook-$VERSION.zip, SHA256SUMS
set -euo pipefail

name="gradebook-$VERSION"
# git archive only takes tracked files: no node_modules, build output or .env
# files.
#
# mobile/ and manager/ are deliberately left out. mobile/ is a root workspace
# and bun.lock still lists it, which is fine: `bun install --frozen-lockfile`
# prints "skipped 1 workspace listed in bun.lock but not on disk" and installs
# the rest (verified on Bun 1.4.4), and turbo resolves the remaining three
# packages. manager/ is the standalone desktop manager app and is packaged
# separately via its own Tauri builds.
git archive --format=zip --prefix="$name/" -o "$name.zip" HEAD \
  frontend backend docs infrastructure \
  ':(exclude,glob)manager/**' \
  ':(exclude,glob)**/.env' \
  ':(exclude,glob)**/.env.local' \
  ':(exclude,glob)**/.env.*.local' \
  ':(exclude,glob)**/*.test.*' \
  ':(exclude,glob)**/*.spec.*' \
  ':(exclude,glob)**/__tests__/**' \
  ':(exclude,glob)**/test/**' \
  ':(exclude,glob)**/tests/**' \
  package.json bun.lock turbo.json tsconfig.json README.md LICENSE.md

# Strip "mobile" from workspaces in the zip's package.json so self-hosters running
# `bun install` do not fail with "Workspace not found mobile".
tmp_dir=$(mktemp -d)
unzip -q "$name.zip" "$name/package.json" -d "$tmp_dir"
sed -i.bak -E 's/"mobile",?//g; s/, *]/]/g' "$tmp_dir/$name/package.json"
rm -f "$tmp_dir/$name/package.json.bak"
(cd "$tmp_dir" && zip -q -u "$OLDPWD/$name.zip" "$name/package.json")
rm -rf "$tmp_dir"

sha256sum "$name.zip" > SHA256SUMS
cat SHA256SUMS
ls -lh "$name.zip"
