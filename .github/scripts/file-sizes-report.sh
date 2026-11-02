#!/usr/bin/env bash
# Builds the repository file size report for git-tracked files: totals by
# top-level folder, files grouped by folder, and a flat largest-first list.
# Renders it to PDF via file-size-report-to-pdf.py and writes a short version
# (folder totals + 30 largest files) to the job summary.
#
# Called by: .github/workflows/file-sizes.yml, step "Build file size report".
# Run from:  the repo root (uses git ls-files and relative paths).
# Needs:     GNU stat and numfmt, python3 with fpdf2 (file-sizes-install-deps.sh).
# Env:       GITHUB_STEP_SUMMARY - job summary file (set by Actions)
# Outputs:   file-size-report.txt, file-size-report.pdf, job summary.
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

tsv="$tmpdir/files.tsv"
report_txt="file-size-report.txt"
report_pdf="file-size-report.pdf"
: > "$tsv"

render_pdf() {
  python3 .github/scripts/file-size-report-to-pdf.py "$report_txt" "$report_pdf"
}

tracked="$(git ls-files)"
if [ -z "$tracked" ]; then
  echo "No tracked files in this checkout." | tee "$report_txt"
  render_pdf
  echo "## Repository file sizes" >> "$GITHUB_STEP_SUMMARY"
  echo "" >> "$GITHUB_STEP_SUMMARY"
  echo "No tracked files in this checkout." >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

git ls-files -z | xargs -0 stat -c '%s %n' 2>/dev/null | awk '
  {
    sz = $1
    $1 = ""
    sub(/^ /, "")
    path = $0
    if (path ~ /\//) {
      split(path, a, "/")
      top = a[1] "/"
    } else {
      top = "(root)"
    }
    print top "\t" sz "\t" path
  }
' > "$tsv"

total_bytes="$(awk -F '\t' '{s+=$2} END {print s+0}' "$tsv")"
total_human="$(numfmt --to=iec-i --suffix=B "$total_bytes" 2>/dev/null || echo "${total_bytes} B")"
file_count="$(wc -l < "$tsv" | tr -d " ")"

{
  echo "Repository file sizes (git-tracked files)"
  echo "==========================================="
  echo ""
  echo "By top-level folder (total bytes in tree)"
  echo "-------------------------------------------"
} > "$report_txt"

awk -F '\t' '{ s[$1] += $2 } END { for (k in s) print s[k] "\t" k }' "$tsv" \
  | sort -t $'\t' -k1,1nr \
  | while IFS=$'\t' read -r bytes folder; do
      human="$(numfmt --to=iec-i --suffix=B "$bytes" 2>/dev/null || echo "${bytes} B")"
      printf "%12s  %s\n" "$human" "$folder" >> "$report_txt"
    done

{
  echo ""
  echo "Files by folder (under each top-level directory, folders by size)"
  echo "----------------------------------------------------------------"
  echo ""
} >> "$report_txt"

awk -F '\t' '{ s[$1] += $2 } END { for (k in s) print s[k] "\t" k }' "$tsv" \
  | sort -t $'\t' -k1,1nr \
  | while IFS=$'\t' read -r fbytes folder; do
      fh="$(numfmt --to=iec-i --suffix=B "$fbytes" 2>/dev/null || echo "${fbytes} B")"
      echo "### $folder - $fh ###" >> "$report_txt"
      echo "" >> "$report_txt"
      awk -F '\t' -v d="$folder" '$1 == d' "$tsv" | sort -t $'\t' -k2,2nr | awk -F '\t' '
        function hum(b,   cmd, x) {
          cmd = "numfmt --to=iec-i --suffix=B " b " 2>/dev/null"
          cmd | getline x
          close(cmd)
          return x
        }
        {
          path = $3
          for (i = 4; i <= NF; i++) {
            path = path "\t" $i
          }
          printf "%12s  %s\n", hum($2), path
        }
      ' >> "$report_txt"
      echo "" >> "$report_txt"
    done

{
  echo ""
  echo "All files (flat, largest first)"
  echo "-------------------------------"
  echo ""
} >> "$report_txt"

sort -t $'\t' -k2,2nr "$tsv" | awk -F '\t' '
  function hum(b,   cmd, x) {
    cmd = "numfmt --to=iec-i --suffix=B " b " 2>/dev/null"
    cmd | getline x
    close(cmd)
    return x
  }
  {
    path = $3
    for (i = 4; i <= NF; i++) {
      path = path "\t" $i
    }
    printf "%12s  %s\n", hum($2), path
  }
' >> "$report_txt"

{
  echo ""
  echo "-------------------------------------------"
  printf "Files: %s  |  Total size: %s\n" "$file_count" "$total_human"
} >> "$report_txt"

render_pdf

echo "## Repository file sizes" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo "Tracked files: **$file_count** - combined size: **$total_human**" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo "### By top-level folder" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo '```' >> "$GITHUB_STEP_SUMMARY"
awk -F '\t' '{ s[$1] += $2 } END { for (k in s) print s[k] "\t" k }' "$tsv" \
  | sort -t $'\t' -k1,1nr \
  | while IFS=$'\t' read -r bytes folder; do
      human="$(numfmt --to=iec-i --suffix=B "$bytes" 2>/dev/null || echo "${bytes} B")"
      printf "%12s  %s\n" "$human" "$folder" >> "$GITHUB_STEP_SUMMARY"
    done
echo '```' >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo "### Largest files (overall)" >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo '```' >> "$GITHUB_STEP_SUMMARY"
# Read every line and print only the first 30: exiting early would
# close the pipe on sort, and pipefail turns its SIGPIPE into a
# failed step once the file list outgrows the pipe buffer.
sort -t $'\t' -k2,2nr "$tsv" | awk -F '\t' '
  function hum(b,   cmd, x) {
    cmd = "numfmt --to=iec-i --suffix=B " b " 2>/dev/null"
    cmd | getline x
    close(cmd)
    return x
  }
  NR <= 30 {
    path = $3
    for (i = 4; i <= NF; i++) {
      path = path "\t" $i
    }
    printf "%12s  %s\n", hum($2), path
  }
' >> "$GITHUB_STEP_SUMMARY"
echo '```' >> "$GITHUB_STEP_SUMMARY"
echo "" >> "$GITHUB_STEP_SUMMARY"
echo "Full report (by folder + flat list) is in the job log and attached as **file-size-report.pdf**." >> "$GITHUB_STEP_SUMMARY"

echo ""
echo "----- Full report (text) -----"
cat "$report_txt"
