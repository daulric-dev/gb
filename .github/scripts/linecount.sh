#!/usr/bin/env bash
set -euo pipefail

echo "Lines of Code Report"
echo "========================"
cloc . --vcs=git --exclude-dir=node_modules,dist,.next --exclude-ext=lock | tee cloc-output.txt

echo "## Lines of Code Report" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo '```' >> "$GITHUB_STEP_SUMMARY"
cat cloc-output.txt >> "$GITHUB_STEP_SUMMARY"
echo '```' >> "$GITHUB_STEP_SUMMARY"
