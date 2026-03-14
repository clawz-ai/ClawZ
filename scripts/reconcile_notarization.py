#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd, *, capture_output=True, check=True):
    return subprocess.run(
        cmd,
        text=True,
        capture_output=capture_output,
        check=check,
    )


def run_json(cmd):
    result = run(cmd)
    return json.loads(result.stdout)


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def normalize_status(raw_status):
    normalized = raw_status.strip().lower().replace(" ", "_")
    if normalized == "accepted":
        return "notarized", False
    if normalized in {"in_progress", "uploaded"}:
        return "pending", True
    if normalized == "invalid":
        return "invalid", True
    return normalized or "query_failed", True


def release_asset_candidates(rc_tag, target):
    rc_version = rc_tag.removeprefix("v")
    stable_version = re.sub(r"-rc\.\d+$", "", rc_version)

    if target == "aarch64-apple-darwin":
        arch = "arm64"
        legacy_arch = "aarch64"
    elif target == "x86_64-apple-darwin":
        arch = "x64"
        legacy_arch = "x64"
    else:
        raise ValueError(f"Unsupported target: {target}")

    return [
        f"ClawZ-{rc_version}-mac-{arch}.dmg",
        f"ClawZ-{stable_version}-mac-{arch}.dmg",
        f"ClawZ_{stable_version}_{legacy_arch}.dmg",
    ]


def find_release_asset(assets, candidates):
    by_name = {asset["name"]: asset for asset in assets}
    for candidate in candidates:
        if candidate in by_name:
            return by_name[candidate]
    return None


def gh_release_assets(repo, tag):
    release = run_json(
        ["gh", "release", "view", tag, "--repo", repo, "--json", "assets"]
    )
    return release["assets"]


def download_release_asset(repo, tag, asset_name, output_dir):
    run(
        [
            "gh",
            "release",
            "download",
            tag,
            "--repo",
            repo,
            "--pattern",
            asset_name,
            "--dir",
            str(output_dir),
        ],
        capture_output=False,
    )
    path = output_dir / asset_name
    if not path.exists():
        raise FileNotFoundError(f"Downloaded asset missing: {path}")
    return path


def upload_release_asset(repo, tag, asset_path):
    run(
        [
            "gh",
            "release",
            "upload",
            tag,
            str(asset_path),
            "--repo",
            repo,
            "--clobber",
        ],
        capture_output=False,
    )


def query_notary_status(submission_id, apple_id, apple_password, team_id):
    result = run(
        [
            "xcrun",
            "notarytool",
            "info",
            submission_id,
            "--apple-id",
            apple_id,
            "--password",
            apple_password,
            "--team-id",
            team_id,
            "--output-format",
            "json",
        ]
    )
    return json.loads(result.stdout)


def staple_dmg(dmg_path):
    run(["xcrun", "stapler", "staple", str(dmg_path)], capture_output=False)
    run(["xcrun", "stapler", "validate", str(dmg_path)], capture_output=False)


def update_metadata_file(path, metadata):
    path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def process_metadata(repo, rc_tag, metadata_path, assets, apple_id, apple_password, team_id):
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    target = metadata.get("target")
    submission_id = metadata.get("submissionId")

    summary = {
        "target": target,
        "previous": metadata.get("status"),
        "current": metadata.get("status"),
        "asset": None,
    }

    if not submission_id:
        metadata["status"] = "missing_submission_id"
        metadata["signedOnly"] = True
        metadata["lastCheckedAt"] = utc_now()
        update_metadata_file(metadata_path, metadata)
        summary["current"] = metadata["status"]
        return summary, True

    try:
        notary_info = query_notary_status(submission_id, apple_id, apple_password, team_id)
    except subprocess.CalledProcessError as exc:
        metadata["status"] = "query_failed"
        metadata["signedOnly"] = True
        metadata["lastCheckedAt"] = utc_now()
        metadata["queryError"] = (exc.stderr or exc.stdout or "").strip()
        update_metadata_file(metadata_path, metadata)
        summary["current"] = metadata["status"]
        return summary, True

    raw_status = str(notary_info.get("status", "query_failed"))
    status, signed_only = normalize_status(raw_status)
    metadata["status"] = status
    metadata["signedOnly"] = signed_only
    metadata["submissionStatus"] = raw_status
    metadata["lastCheckedAt"] = utc_now()

    asset_candidates = release_asset_candidates(rc_tag, target)
    asset = find_release_asset(assets, asset_candidates)
    if asset:
        summary["asset"] = asset["name"]

    if status == "notarized":
        if not asset:
            metadata["status"] = "missing_release_asset"
            metadata["signedOnly"] = True
            update_metadata_file(metadata_path, metadata)
            summary["current"] = metadata["status"]
            return summary, True

        with tempfile.TemporaryDirectory(prefix="clawz-notarize-") as tmp:
            tmpdir = Path(tmp)
            dmg_path = download_release_asset(repo, rc_tag, asset["name"], tmpdir)
            staple_dmg(dmg_path)
            upload_release_asset(repo, rc_tag, dmg_path)

    update_metadata_file(metadata_path, metadata)
    summary["current"] = metadata["status"]
    return summary, status in {"invalid", "query_failed", "missing_release_asset"}


def main():
    parser = argparse.ArgumentParser(
        description="Reconcile pending macOS notarization for an RC release."
    )
    parser.add_argument("--rc-tag", required=True, help="RC tag, for example: v0.1.2-rc.1")
    args = parser.parse_args()

    if not re.fullmatch(r"v\d+\.\d+\.\d+-rc\.\d+", args.rc_tag):
        raise SystemExit("rc-tag must match vX.Y.Z-rc.N")

    repo = os.environ.get("GITHUB_REPOSITORY", "clawz-ai/ClawZ")
    apple_id = require_env("APPLE_ID")
    apple_password = require_env("APPLE_PASSWORD")
    team_id = require_env("APPLE_TEAM_ID")

    assets = gh_release_assets(repo, args.rc_tag)

    with tempfile.TemporaryDirectory(prefix="clawz-meta-") as tmp:
        tmpdir = Path(tmp)
        run(
            [
                "gh",
                "release",
                "download",
                args.rc_tag,
                "--repo",
                repo,
                "--pattern",
                "notarization-*-apple-darwin.json",
                "--dir",
                str(tmpdir),
            ],
            capture_output=False,
        )

        metadata_files = sorted(tmpdir.glob("notarization-*-apple-darwin.json"))
        if not metadata_files:
            raise SystemExit("No macOS notarization metadata found on the release")

        summaries = []
        has_error = False

        for metadata_file in metadata_files:
            summary, failed = process_metadata(
                repo,
                args.rc_tag,
                metadata_file,
                assets,
                apple_id,
                apple_password,
                team_id,
            )
            summaries.append(summary)
            has_error = has_error or failed
            upload_release_asset(repo, args.rc_tag, metadata_file)

    print("Notarization reconciliation summary:")
    for item in summaries:
        asset_text = f" ({item['asset']})" if item["asset"] else ""
        print(f"- {item['target']}: {item['previous']} -> {item['current']}{asset_text}")

    if has_error:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
