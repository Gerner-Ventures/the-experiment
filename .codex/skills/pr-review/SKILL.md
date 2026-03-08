---
name: pr-review
description: Review a GitHub pull request for this repository when the user starts the prompt with `$pr-review` followed by a PR number, such as `$pr-review 105`. Conduct a real PR review focused primarily on backend correctness, API/schema consistency, persistence/runtime safety, and frontend interoperability with the backend. Submit the final review on GitHub as either approval or changes requested.
---

# PR Review

Review pull requests for this repository and submit an actual GitHub review.

## Invocation

- Expected prompt shape: `$pr-review <number>`
- Example: `$pr-review 105`

If the user provides the skill name without a PR number, stop and ask for the PR number.

## Review Standard

- Default stance: pragmatic, not fussy.
- Focus on bugs, regressions, unsafe assumptions, contract mismatches, persistence/runtime hazards, and missing coverage where it matters.
- Do not burn review capital on formatting, naming bikesheds, or minor style issues.
- For backend-heavy PRs, review deeply across runtime flow, persistence, schemas, tests, and docs.
- For frontend-heavy PRs, spend less time on UI polish and more time on:
  - API contract compatibility
  - websocket/event payload consistency
  - schema drift
  - assumptions about backend behavior, timing, persistence, and failure modes

## Repo Priorities

Read only the docs relevant to the changed area:

- `README.md` for repo context
- `docs/BACKEND.md` for backend layout and workflows
- `docs/GAME_RUNTIME.md` for round loop, persistence, and websocket behavior
- `docs/API.md` and `shared/schemas/` for contract changes
- `docs/GAME_DESIGN.md` for intentional mechanic changes
- `docs/INFRASTRUCTURE.md` for deployment or persistence implications

## Workflow

1. Parse the PR number from the prompt.
2. Load PR metadata with GitHub CLI.
3. Inspect the file list and diff before reading broader repo context.
4. Read the touched files plus any nearby code required to understand correctness.
5. Run targeted tests or checks when they materially reduce uncertainty, especially for backend changes.
6. Decide whether findings are blocking or non-blocking.
7. Submit a GitHub review, not just a local summary.

Useful commands:

```bash
gh pr view <number> --json number,title,body,baseRefName,headRefName,author,files,commits,url
gh pr diff <number> --patch
gh pr checkout <number>
```

Use `gh pr checkout <number>` when local execution or deeper code navigation would help. Do not disturb unrelated local changes.

## Findings Format

Every substantive finding should include:

- `Blocking` or `Non-blocking`
- Severity: `Critical`, `High`, `Medium`, or `Low`
- A short title
- Why it matters
- Concrete evidence from the diff or impacted code path
- The smallest reasonable fix or mitigation

Recommended format inside the review body:

```text
Blocking
- [High] Round state is persisted before GM plan approval
  This can leave the experiment in an impossible partially-applied state after a restart.

Non-blocking
- [Low] Test names do not describe the failure mode
  Not a merge blocker, but it will make later regressions harder to diagnose.
```

## Verdict Rules

- If there is any blocking finding, submit `REQUEST_CHANGES`.
- If there are no blocking findings, submit `APPROVE`.
- Non-blocking findings can still be included in an approval review.
- If there are no findings, say so plainly and approve.

## Tone

- Keep the review concrete and useful.
- Sprinkle in a little silliness where it fits naturally.
- Do not let jokes obscure the technical point.
- If the PR introduces a truly catastrophic bug, you may be blunt and a bit mean, but still keep the review actionable and specific.

## Submission

Draft the full review body in a temp file, then submit it with GitHub CLI:

```bash
gh pr review <number> --approve --body-file /tmp/review.txt
gh pr review <number> --request-changes --body-file /tmp/review.txt
```

Before submitting:

- Make sure the body clearly separates blocking from non-blocking findings.
- Include the final verdict in the opening sentence.
- Mention tests/checks run when relevant.
- Do not leave the result as a local note; the review must be submitted to GitHub.
