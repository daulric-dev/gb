#!/usr/bin/env python3
"""Build and send a Discord webhook embed notification."""

import json
import os
import subprocess
import sys


def main():
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        print("Missing DISCORD_WEBHOOK_URL", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps({
        "embeds": [{
            "title": os.environ.get("EMBED_TITLE", "Notification"),
            "description": os.environ.get("EMBED_DESCRIPTION", ""),
            "url": os.environ.get("CHANGES_URL", ""),
            "color": int(os.environ.get("EMBED_COLOR", "3066993")),
            "footer": {"text": "GitHub Actions"},
        }]
    })

    result = subprocess.run(
        [
            "curl", "--fail", "--silent", "--show-error",
            "-H", "Content-Type: application/json",
            "-X", "POST",
            "-d", payload,
            webhook_url,
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"curl failed: {result.stderr}", file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
