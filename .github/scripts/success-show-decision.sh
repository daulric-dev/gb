#!/usr/bin/env bash
# Logs the notification decision for the run.
#
# Called by: .github/workflows/success.yml, step "Show notification decision".
# Env:       EVENT_NAME   - github.event_name
#            ALL_SUCCESS  - all_success output (workflow_run or manual step)
#            HAS_FAILURES - has_failures output
#            DETAILS      - details output (multi-line markdown)
# Outputs:   none (log only).
set -euo pipefail

echo "workflow event: $EVENT_NAME"
echo "all_success: $ALL_SUCCESS"
echo "has_failures: $HAS_FAILURES"
echo "details:"
echo "$DETAILS"
