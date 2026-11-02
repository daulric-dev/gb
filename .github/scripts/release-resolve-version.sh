#!/usr/bin/env bash
# Resolves the release version (without a leading "v") and validates it as
# semver.
#
# Called by: .github/workflows/release.yml, job "package", step "Resolve version".
# Env:       GITHUB_EVENT_NAME - "push" uses the tag in GITHUB_REF_NAME,
#                                anything else uses INPUT_VERSION
#            GITHUB_REF_NAME   - the pushed tag, e.g. v1.2.3
#            INPUT_VERSION     - inputs.version from workflow_dispatch
#            GITHUB_OUTPUT     - step output file
# Outputs:   version=<x.y.z[-pre][+build]> to GITHUB_OUTPUT; exits 1 if invalid.
set -euo pipefail

if [ "$GITHUB_EVENT_NAME" = "push" ]; then
  version="${GITHUB_REF_NAME#v}"
else
  version="${INPUT_VERSION#v}"
fi
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
  echo "Invalid version: '$version'" >&2
  exit 1
fi
echo "version=$version" >> "$GITHUB_OUTPUT"
