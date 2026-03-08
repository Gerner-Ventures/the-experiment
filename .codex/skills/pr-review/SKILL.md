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

Use `gh pr checkout <number>` when local execution or deeper code navigation would help, but only from a clean checkout or disposable worktree. If the current checkout has unrelated local changes, inspect the PR with `gh pr view` and `gh pr diff` instead of stomping around like a raccoon in the pantry.

## Findings Format

Every substantive finding should include:

- `Blocking` or `Non-blocking`
- Severity: `Critical`, `High`, `Medium`, or `Low`
- Classification: a short label such as `Bug`, `Regression`, `Duplication`, `Schema drift`, `Test gap`, `Performance`, `Reliability`, or `Maintainability`
- A short title
- Why it matters
- Concrete evidence from the diff or impacted code path
- The smallest reasonable fix or mitigation

Write each finding as a short item header followed by 2-4 tiny paragraphs. Do not cram the entire point into one dense bullet. Use blank lines between the sections so each item is easy to scan on GitHub.

Recommended format inside the review body:

```text
Verdict: Request changes 🚫🧱💀💩

## Blocking
- **[High][Regression 🧨] Round state is persisted before GM plan approval**

  Why it matters: this is how you end up with a save file that wakes back up in a state the runtime never meant to support.

  Evidence: the new write happens before the approval gate, so one crash and now the database is proudly preserving nonsense.

  Fix: move persistence behind the approval boundary or persist an explicit intermediate state that recovery understands.

## Non-blocking
- **[Low][Test gap 🧪] Test names do not describe the failure mode**

  Why it matters: not a merge blocker, but future-you should not need a séance to figure out what the failing test was supposed to prove.

  Fix: rename the cases so the broken behavior is obvious from the failing test output.
```

Classification labels do not need to be fancy, but they should be concrete. Emojis are welcome when they improve scanning:

- `Bug 🐛`
- `Regression 🧨`
- `Duplication 🪞`
- `Schema drift 🧬`
- `Test gap 🧪`
- `Performance 🐢`
- `Reliability 💥`
- `Maintainability 🧹`

## Verdict Rules

- If there is any blocking finding, submit `REQUEST_CHANGES`.
- If there are no blocking findings, submit `APPROVE`.
- Non-blocking findings can still be included in an approval review.
- If there are no findings, say so plainly and approve.

## Tone

- Keep the review concrete and useful.
- Be a little sassy on purpose so the review is more fun to read than a slab of drywall.
- Do not let jokes obscure the technical point.
- Use Markdown that renders cleanly on GitHub: short headers, bold labels, compact bullets, and short paragraphs with breathing room.
- Lean into emoji for scanning, especially on `REQUEST_CHANGES` reviews. A little troll energy is fine, including the occasional `💩` when the code path truly earned it.
- Dry sarcasm, mild mockery, and "this code is being weird" energy are all welcome.
- On `APPROVE` reviews, positive sarcasm and silly praise are welcome too. Lines like `Awesome job!!!` or `I'm proud of you, great work!!` are fair game when the PR actually earned it.
- Keep the humor pointed at the bad code path, not the human who wrote it.
- Prefer lines that sound like a sharp reviewer with taste, not a generic assistant trying to be quirky.
- If the PR introduces a truly catastrophic bug, you may be blunt and a bit mean, but still keep the review actionable and specific.

## Submission

Draft the full review body in a unique temp file, then submit it with GitHub CLI.

Submit exactly one review per invocation. Choose the command that matches the verdict and never run both review commands.

```bash
review_file="$(mktemp -t pr-review.XXXXXX)"

if [ "$verdict" = "APPROVE" ]; then
  gh pr review <number> --approve --body-file "$review_file"
else
  gh pr review <number> --request-changes --body-file "$review_file"
fi
```

Before submitting:

- Make sure the body is easy to scan on GitHub with a top line like `Verdict: Request changes 🚫🧱💀💩`, then sections such as `## Blocking`, `## Non-blocking`, and `## Checks`.
- Put the verdict on one line. Do not render a `## Verdict` header with the decision stranded beneath it.
- For `REQUEST_CHANGES`, feel free to be louder with negative emoji, including `💩` when it helps sell the disaster.
- For approvals, keep the emoji lighter, but feel free to sound theatrically pleased when the work is genuinely strong.
- Mention tests/checks run when relevant.
- Set a local `verdict` variable first (`APPROVE` or `REQUEST_CHANGES`) so the submission path is unambiguous.
- If the submit command errors after the network request may already have reached GitHub, do not blindly retry. First inspect the PR's latest review from your account, confirm whether the review was created, and only resubmit if it definitely was not.
- After submitting, verify that exactly one new review was created before reporting completion.
- Clean up the temp file after submission.
- Do not leave the result as a local note; the review must be submitted to GitHub.
