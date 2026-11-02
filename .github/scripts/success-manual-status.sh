#!/usr/bin/env bash
# Writes the same step outputs check-workflow-status.js produces, for a manual
# workflow_dispatch test run (reported as all successful).
#
# Called by: .github/workflows/success.yml, step "Prepare manual dispatch status output".
# Env:       GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID,
#            GITHUB_OUTPUT (all set by Actions)
# Outputs:   all_success, has_failures, details, head_sha, event_name, run_url,
#            changes_url to GITHUB_OUTPUT.
set -euo pipefail

echo "all_success=true" >> "$GITHUB_OUTPUT"
echo "has_failures=false" >> "$GITHUB_OUTPUT"
echo "details=- Manual workflow_dispatch test run" >> "$GITHUB_OUTPUT"
echo "head_sha=${GITHUB_SHA}" >> "$GITHUB_OUTPUT"
echo "event_name=workflow_dispatch" >> "$GITHUB_OUTPUT"
echo "run_url=${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" >> "$GITHUB_OUTPUT"
echo "changes_url=${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}" >> "$GITHUB_OUTPUT"
