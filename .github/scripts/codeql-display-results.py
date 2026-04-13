#!/usr/bin/env python3
"""Parse CodeQL SARIF output and print results to stdout."""

import json
import sys
import glob

def main():
    sarif_files = glob.glob("codeql-results/*.sarif")
    if not sarif_files:
        print("No SARIF files found.")
        return

    found = False
    for path in sarif_files:
        with open(path) as f:
            sarif = json.load(f)
        for run in sarif.get("runs", []):
            for r in run.get("results", []):
                found = True
                rule = r.get("ruleId", "?")
                msg = r.get("message", {}).get("text", "")
                locs = r.get("locations", [{}])
                phys = locs[0].get("physicalLocation", {}) if locs else {}
                uri = phys.get("artifactLocation", {}).get("uri", "?")
                line = phys.get("region", {}).get("startLine", "?")
                print(f"{rule} | {uri}:{line} | {msg}")

    if not found:
        print("No issues found.")


if __name__ == "__main__":
    main()
