#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "Frontend Breakdown"
echo "==============="

echo "" >> "$GITHUB_STEP_SUMMARY"
echo "### Frontend" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"

for dir in frontend/app frontend/components frontend/lib; do
  if [ -d "$dir" ]; then
    echo "--- $dir/ ---"
    cloc "$dir" --vcs=git --quiet
  fi
done
