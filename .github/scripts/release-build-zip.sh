#!/usr/bin/env bash
# Packages the frontend, backend and docs sources plus the root workspace files
# into gradebook-<VERSION>.zip and writes its checksum to SHA256SUMS, both in
# the current directory (the repo root).
#
# Called by: .github/workflows/release.yml, job "package", step "Build zip".
# Env:       VERSION - resolved version from release-resolve-version.sh
# Outputs:   gradebook-$VERSION.zip, SHA256SUMS
set -euo pipefail

name="gradebook-$VERSION"
# git archive only takes tracked files: no node_modules, build
# output or .env files.
git archive --format=zip --prefix="$name/" -o "$name.zip" HEAD \
  frontend backend docs \
  package.json bun.lock turbo.json tsconfig.json README.md LICENSE.md
sha256sum "$name.zip" > SHA256SUMS
cat SHA256SUMS
ls -lh "$name.zip"
