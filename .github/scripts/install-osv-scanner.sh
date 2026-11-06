#!/usr/bin/env bash
set -euo pipefail

# Pinned release (v2.7.0 = commit bfe2f84abd2f09fe0b83ba7f6dad40d296762f40).
# v2 lives under the /v2 module path; a bare `osv-scanner@latest` resolves to
# the last v1 release. Its go.mod needs a newer Go than the runner may ship,
# so let `go install` fetch the toolchain it asks for.
OSV_SCANNER_VERSION="v2.7.0"

GOTOOLCHAIN=auto go install \
  "github.com/google/osv-scanner/v2/cmd/osv-scanner@${OSV_SCANNER_VERSION}"
echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
