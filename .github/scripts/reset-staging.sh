#!/usr/bin/env bash
# Points the staging branch at main's current commit (force-updates it, or
# creates it if it does not exist).
#
# Called by: .github/workflows/reset-staging.yml, step "Reset staging to main".
# Env:       GH_TOKEN          - token allowed to write refs
#            GITHUB_REPOSITORY - owner/repo (set by Actions)
# Outputs:   none.
set -euo pipefail

MAIN_SHA=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')

if gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/staging" >/dev/null 2>&1; then
  gh api "repos/$GITHUB_REPOSITORY/git/refs/heads/staging" \
    -X PATCH \
    -f sha="$MAIN_SHA" \
    -F force=true
else
  gh api "repos/$GITHUB_REPOSITORY/git/refs" \
    -X POST \
    -f ref="refs/heads/staging" \
    -f sha="$MAIN_SHA"
fi
