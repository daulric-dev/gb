#!/usr/bin/env bash
# Fails the CI gate unless the build job succeeded.
#
# Called by: .github/workflows/ci.yml, job "gate", step "Check results".
# Env:       BUILD_RESULT - needs.build.result (success|failure|cancelled|skipped)
# Outputs:   none; exits 1 when the build did not succeed.
set -euo pipefail

if [ "$BUILD_RESULT" != "success" ]; then
  echo "CI failed: build=$BUILD_RESULT"
  exit 1
fi
echo "All checks passed"
