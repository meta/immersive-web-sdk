#!/usr/bin/env python3

import argparse
import json
import subprocess


IWSDK_PREFIX = "immersive-web-sdk/"
CI_CONFIG_PATHS = {".jfconfig"}


def changed_files(parent_rev: str, rev: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "-z", parent_rev, rev],
        check=True,
        capture_output=True,
        text=True,
    )
    return [path for path in result.stdout.split("\0") if path]


def should_run(paths: list[str]) -> bool:
    return any(
        path.startswith(IWSDK_PREFIX) or path in CI_CONFIG_PATHS for path in paths
    )


def quality_job(rev: str) -> dict[str, object]:
    runner = "bash immersive-web-sdk/ci/sandcastle/run-check.sh"
    return {
        "command": "SandcastleUniversalCommand",
        "alias": "iwsdk-quality",
        "oncall": "oculus_browser_devex",
        "scheduleType": "diff",
        "hash": rev,
        "tags": ["iwsdk", "quality"],
        "capabilities": {
            "type": "lego",
            "vcs": "oculus-webxr-git",
            "tenant": "oculus-browser",
        },
        "args": {
            "name": "IWSDK quality",
            "oncall": "oculus_browser_devex",
            "timeout": 14400,
            "skip_if_error_exists_on_base_revision": True,
            "steps": [
                {
                    "name": "Run IWSDK quality checks",
                    "shell": f"{runner} all",
                    "required": True,
                    "timeout": 14400,
                },
                {
                    # Starters are expected to grow, so an exceeded size budget
                    # is a yellow warning on the diff rather than a failure. It
                    # reuses the tarballs the quality step built.
                    "name": "Check starter bundle sizes (warning only)",
                    "shell": f"{runner} bundle-size",
                    "required": False,
                    "timeout": 3600,
                },
            ],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rev", required=True)
    parser.add_argument("--parent-rev", required=True)
    args = parser.parse_args()

    paths = changed_files(args.parent_rev, args.rev)
    jobs = [quality_job(args.rev)] if should_run(paths) else []
    print(json.dumps(jobs, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
