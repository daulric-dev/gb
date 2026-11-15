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
# mobile/ is deliberately left out. It is a root workspace and bun.lock still
# lists it, which is fine: `bun install --frozen-lockfile` prints "skipped 1
# workspace listed in bun.lock but not on disk" and installs the rest
# (verified on Bun 1.4.4), and turbo resolves the remaining three packages.
# A self-hoster who wants to build the app against their own server takes it
# from the repository, where the Expo tooling and mobile/README.md are.
git archive --format=zip --prefix="$name/" -o "$name.zip" HEAD \
  frontend backend docs infrastructure \
  ':(exclude,glob)**/.env' \
  ':(exclude,glob)**/.env.local' \
  ':(exclude,glob)**/.env.*.local' \
  ':(exclude,glob)**/*.test.*' \
  ':(exclude,glob)**/*.spec.*' \
  ':(exclude,glob)**/__tests__/**' \
  ':(exclude,glob)**/test/**' \
  ':(exclude,glob)**/tests/**' \
  package.json bun.lock turbo.json tsconfig.json README.md LICENSE.md
sha256sum "$name.zip" > SHA256SUMS
cat SHA256SUMS
ls -lh "$name.zip"
