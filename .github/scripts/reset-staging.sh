#!/usr/bin/env bash
# Points the staging branch at main's current commit after a staging -> main
# PR merges (or creates staging if it does not exist).
#
# Safety: staging is only reset when its current head is exactly the commit
# that was merged (the PR's head.sha). If commits were pushed to staging after
# the PR was merged/snapshotted, the reset is refused and the job fails, so
# that work is never silently discarded.
#
# Called by: .github/workflows/reset-staging.yml, step "Reset staging to main".
# Env:       GH_TOKEN          - token allowed to write refs
#            GITHUB_REPOSITORY - owner/repo (set by Actions)
#            PR_HEAD_SHA       - head.sha of the merged PR
# Outputs:   none.
set -euo pipefail

: "${PR_HEAD_SHA:?PR_HEAD_SHA is required}"

MAIN_SHA=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')

if STAGING_SHA=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/staging" --jq '.object.sha' 2>/dev/null); then
  if [ "$STAGING_SHA" != "$PR_HEAD_SHA" ]; then
    echo "::error title=Staging not reset::staging is at $STAGING_SHA but the merged PR head was $PR_HEAD_SHA. Commits were pushed to staging after this PR; refusing to force-reset staging to main ($MAIN_SHA). Merge main into staging (or reset it) manually."
    exit 1
  fi
  if [ "$STAGING_SHA" = "$MAIN_SHA" ]; then
    echo "staging already at main ($MAIN_SHA); nothing to do."
    exit 0
  fi
  gh api "repos/$GITHUB_REPOSITORY/git/refs/heads/staging" \
    -X PATCH \
    -f sha="$MAIN_SHA" \
    -F force=true
  echo "staging reset from $STAGING_SHA to main ($MAIN_SHA)."
else
  gh api "repos/$GITHUB_REPOSITORY/git/refs" \
    -X POST \
    -f ref="refs/heads/staging" \
    -f sha="$MAIN_SHA"
  echo "staging created at main ($MAIN_SHA)."
fi
