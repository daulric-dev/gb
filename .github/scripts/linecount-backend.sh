#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "Backend Breakdown"
echo "==============="

echo "" >> "$GITHUB_STEP_SUMMARY"
echo "### Backend" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"

if [ -d "backend/src" ]; then
  cloc backend/src --vcs=git --quiet
else
  echo "No backend/src directory yet"
fi
