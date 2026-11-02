#!/usr/bin/env bash
# Creates the GitHub Release for a version tag and attaches the zip and
# SHA256SUMS (downloaded into the current directory). Tags containing "-"
# (e.g. v1.2.3-rc.1) are marked as prereleases.
#
# Called by: .github/workflows/release.yml, job "publish", step "Create GitHub Release".
# Env:       GH_TOKEN - token with contents: write
#            GH_REPO  - owner/repo
#            TAG      - the pushed tag, e.g. v1.2.3
#            VERSION  - resolved version, e.g. 1.2.3
# Outputs:   the GitHub Release.
set -euo pipefail

prerelease=()
case "$TAG" in *-*) prerelease=(--prerelease) ;; esac
gh release create "$TAG" "gradebook-$VERSION.zip" SHA256SUMS \
  --verify-tag \
  --title "GradeBook $VERSION" \
  --generate-notes \
  "${prerelease[@]}"
