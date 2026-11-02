#!/usr/bin/env bash
# Installs what the file size report needs: the DejaVu font and fpdf2 for
# file-size-report-to-pdf.py.
#
# Called by: .github/workflows/file-sizes.yml, step "Install dependencies".
# Env:       none (expects apt + pip on the runner, after actions/setup-python).
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y fonts-dejavu-core
pip install --quiet fpdf2
