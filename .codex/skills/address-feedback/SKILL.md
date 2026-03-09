---
name: address-feedback
description: Address GitHub pull request feedback for this repository when the user starts the prompt with `$address-feedback` followed by a PR number, such as `$address-feedback 105`, or when the active session is already clearly about a single PR. Pull unresolved review threads plus top-level PR comments and submitted review bodies with `gh`, limit Claude-bot feedback to one substantive item, decide pragmatically which requests are worth changing, push one commit, optionally update the PR description, and post GitHub replies that say what was addressed versus declined.
---

# Address Feedback

Handle PR feedback end to end for this repository.

## Invocation

- Preferred: `$address-feedback <number>`
- Example: `$address-feedback 105`
- Allowed without a number: `$address-feedback`

If the PR number is omitted, infer it only when the target PR is unambiguous from the current branch or the active thread context. Otherwise, stop and ask for the PR number.

## Working Stance

- Be pragmatic, not obedient.
- Fix issues that improve correctness, safety, contract clarity, or worthwhile maintainability.
- Push back on style churn, speculative refactors, and scope creep.
- Do not let a noisy bot drag the PR into review hell.

## Resolve The PR

1. Determine the PR number.
2. Immediately check out the PR branch before digesting feedback or making code changes.
3. Sync it to the latest remote head before making changes.

Do not triage feedback from some unrelated local branch and then hope reality lines up later. Get onto the PR branch first.

Useful commands:

```bash
gh pr view <number> --json number,title,url,headRefName,baseRefName
gh pr checkout <number>
git pull --ff-only origin "$(gh pr view <number> --json headRefName --jq .headRefName)"
```

If the skill was invoked without a PR number, try:

```bash
gh pr view --json number,title,url,headRefName
```

Only continue if that resolves to the intended PR cleanly.

This checkout step comes before reading review threads in detail, editing files, or running targeted tests. The rest of the workflow should happen from the PR branch.

## Build A Feedback Ledger

Before changing code, gather all outstanding feedback into a short working ledger with:

- source URL
- reviewer/login
- kind: inline thread, top-level PR comment, or submitted review body
- requested change
- disposition: `address`, `decline`, or `needs clarification`

Treat these as the feedback sources:

1. Unresolved inline review threads
2. Top-level PR conversation comments
3. Latest submitted review bodies that contain actionable requests not already captured by inline threads

Start with PR metadata:

```bash
gh pr view <number> --json number,title,body,url,comments,reviews,latestReviews,commits
```

Pull unresolved inline threads with GraphQL:

```bash
gh api graphql -F owner='{owner}' -F name='{repo}' -F number=<number> -f query='
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first:30) {
            nodes {
              id
              databaseId
              url
              body
              createdAt
              author { login }
            }
          }
        }
      }
    }
  }
}'
```

Heuristics:

- Use unresolved review threads as the source of truth for inline feedback.
- Use `latestReviews` before `reviews` when you want one current top-level signal per reviewer.
- Do not keep both a `latestReviews` item and a `reviews` item for the same reviewer request. If they overlap, keep the newest actionable version only once in the ledger.
- Skip items that already have a later reply from you clearly stating the outcome.
- Ignore empty praise, approval-only reviews, and comments that do not ask for a change.

## Claude-Bot Limit

Claude bot feedback is noisy in this repo.

- Keep at most one substantive Claude item in the ledger.
- Prefer the newest Claude comment or review that contains concrete requested changes.
- Drop the rest unless they raise a materially different bug.
- Human feedback does not have this cap.

## Decide What To Do

For each ledger item that requests a change:

- `address` when the feedback catches a bug, regression risk, contract mismatch, missing safety check, or worthwhile test/doc gap
- `decline` when the feedback is style-only, speculative, redundant, or expands scope without enough payoff
- `needs clarification` only when you cannot safely implement or decline without more information

When declining feedback, be direct. Explain the tradeoff and why the current PR should keep moving.

## Make The Changes

1. Implement the accepted changes.
2. Run the smallest relevant checks that materially reduce risk.
3. Update docs if the feedback changed behavior, contracts, or workflow.
4. Update the PR description if the shape of the PR materially changed.

Useful commands:

```bash
gh pr edit <number> --body-file /tmp/pr-body.md
```

Keep the branch clean:

- Make one commit for the entire feedback pass.
- Do not drip out one commit per comment.
- Push once after the checks you actually trust.

## Push

Commit and push exactly one new commit for this feedback pass.

```bash
git status --short
git add <files>
git commit -m "address PR feedback"
git push origin HEAD
```

If you had to amend the PR description, do that before the final response pass.

## Respond On GitHub

After the push succeeds, respond to every actionable feedback item you kept in the ledger, but do it exactly once per item.

### Inline review threads

Reply inline to the latest review comment in each unresolved thread. Keep the reply short and explicit:

- what changed, or
- why you are not taking the suggestion

Useful command:

```bash
gh api \
  repos/{owner}/{repo}/pulls/<number>/comments/<comment_id>/replies \
  -f body='Addressed in <commit-sha>: switched to catalog-derived ids and added regression coverage.'
```

If the thread is fully handled, resolve it:

```bash
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}' -F threadId='<thread-id>'
```

### Top-level PR comments and review bodies

Post one new PR review comment after the push that summarizes the whole batch. This is the main "feedback addressed" note.

Use sections like:

```text
## Addressed
- <reviewer>: fixed X in <commit>

## Not Taking
- <reviewer>: not taking Y because it broadens scope without clear payoff

## Checks
- <commands run>
```

Submit it as a new review comment. Use the helper so the step is idempotent for the current head commit and body:

```bash
review_file="$(mktemp -t address-feedback.XXXXXX)"
python3 .codex/skills/address-feedback/scripts/post_summary_review.py <number> "$review_file"
rm -f "$review_file"
```

The helper checks existing PR reviews from the authenticated GitHub user. If an identical summary review is already present on the current `HEAD` commit, it exits successfully without posting again. Do not fall back to a raw `gh pr review` retry after the helper reports success.

If a top-level PR comment needs a direct answer that would be lost in the summary review, add one normal PR comment that links back to the original feedback item. Do this only when the summary review is not enough on its own. Never restate the same disposition in both the summary review and a separate PR comment unless the extra comment adds information the summary cannot carry.

```bash
gh pr comment <number> --body-file /tmp/pr-comment.md
```

## Completion Standard

Do not stop until all of these are true:

- the accepted changes are committed and pushed
- the PR description is updated if needed
- every actionable feedback item has an explicit disposition in your ledger
- inline threads have replies, and resolved ones are marked resolved
- the PR has one fresh summary review comment listing addressed and declined items

The outcome should be one clean feedback pass, not a ceremonial apology tour.
