#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path


def run_command(*args: str) -> str:
    completed = subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "command failed"
        raise RuntimeError(f"{' '.join(args)}: {message}")
    return completed.stdout


def normalize_body(body: str) -> str:
    return body.replace("\r\n", "\n").strip()


def load_reviews(pr_number: str) -> list[dict]:
    output = run_command("gh", "pr", "view", pr_number, "--json", "reviews")
    payload = json.loads(output)
    return payload.get("reviews", [])


def current_login() -> str:
    return run_command("gh", "api", "user", "--jq", ".login").strip()


def current_head() -> str:
    return run_command("git", "rev-parse", "HEAD").strip()


def matching_reviews(
    reviews: list[dict],
    *,
    author_login: str,
    commit_oid: str,
    body: str,
) -> list[dict]:
    matches = []
    for review in reviews:
        if review.get("state") != "COMMENTED":
            continue
        author = (review.get("author") or {}).get("login")
        if author != author_login:
            continue
        review_commit = (review.get("commit") or {}).get("oid")
        if review_commit != commit_oid:
            continue
        if normalize_body(review.get("body") or "") != body:
            continue
        matches.append(review)
    return matches


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: post_summary_review.py <pr-number> <body-file>",
            file=sys.stderr,
        )
        return 2

    pr_number = sys.argv[1]
    body_file = Path(sys.argv[2])
    if not body_file.is_file():
        print(f"body file not found: {body_file}", file=sys.stderr)
        return 2

    body = normalize_body(body_file.read_text())
    if not body:
        print("review body is empty", file=sys.stderr)
        return 2

    author_login = current_login()
    commit_oid = current_head()

    before_matches = matching_reviews(
        load_reviews(pr_number),
        author_login=author_login,
        commit_oid=commit_oid,
        body=body,
    )
    if before_matches:
        print(
            "Summary review already exists for this commit and body; skipping duplicate post."
        )
        return 0

    review_output = run_command(
        "gh",
        "pr",
        "review",
        pr_number,
        "--comment",
        "--body-file",
        str(body_file),
    )
    if review_output.strip():
        print(review_output.strip())

    after_matches = matching_reviews(
        load_reviews(pr_number),
        author_login=author_login,
        commit_oid=commit_oid,
        body=body,
    )
    if len(after_matches) != 1:
        print(
            "Expected exactly one matching summary review after submission; found "
            f"{len(after_matches)}.",
            file=sys.stderr,
        )
        return 1

    print("Posted summary review comment.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
