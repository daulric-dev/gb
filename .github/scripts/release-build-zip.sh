#!/usr/bin/env bash
# Packages the frontend, backend, docs and mobile sources, the self-hosting
# files in infrastructure/ and the root workspace files into
# gradebook-<VERSION>.zip and writes its checksum to SHA256SUMS, both in
# the current directory (the repo root).
#
# Called by: .github/workflows/release.yml, job "package", step "Build zip".
# Env:       VERSION - resolved version from release-resolve-version.sh
# Outputs:   gradebook-$VERSION.zip, SHA256SUMS
set -euo pipefail

name="gradebook-$VERSION"
# git archive only takes tracked files: no node_modules, build
# output or .env files. mobile/ is a root workspace, so `bun install
# --frozen-lockfile` needs its package.json; the rest of its source lets a
# self-hoster build the app against their own server. The generated native
# iOS project is left out (`expo prebuild` recreates it).
git archive --format=zip --prefix="$name/" -o "$name.zip" HEAD \
  frontend backend docs mobile infrastructure \
  ':(exclude)mobile/ios' \
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
