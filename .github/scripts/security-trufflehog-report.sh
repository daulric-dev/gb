#!/usr/bin/env bash
# Runs TruffleHog (verified secrets only) over the repo's git history in
# Docker and saves the output to trufflehog-report.txt. Never fails the step.
#
# Called by: .github/workflows/security.yml, job "secrets-scan", step "Run TruffleHog (report file)".
# Env:       none (run from the repo root).
# Outputs:   trufflehog-report.txt
set -euo pipefail

docker run --rm -v "$PWD:/repo" trufflesecurity/trufflehog:3.97.9 git file:///repo --only-verified 2>&1 | tee trufflehog-report.txt || true
