#!/usr/bin/env bash
set -euo pipefail

go install github.com/google/osv-scanner/cmd/osv-scanner@latest
echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
