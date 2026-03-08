---
title: "CI Coverage Gating with diff-cover"
status: todo
priority: P1
tags: [ci, testing, coverage, infrastructure]
depends_on: []
---

# CI Coverage Gating with diff-cover

No coverage collection or gating exists in CI today. Tests run but we have no visibility into what they actually cover, and PRs can merge with zero test coverage on new code. This spec adds coverage reporting to both frontend and backend, and gates PRs on 80% coverage of changed lines using `diff-cover`.

## Background

**Current state:**
- Frontend: 54 source files, 14 unit test files. Jest config has `collectCoverageFrom` but coverage is never collected in CI.
- Backend: 11 test files, pytest. No `pytest-cov` dependency, no coverage output.
- CI (`ci.yml`): Runs lint, type-check, build, unit tests, E2E — no coverage steps.

**Approach:** Use `diff-cover` to check coverage on changed lines only. This avoids requiring retroactive coverage on legacy code while ensuring all new/modified code meets the 80% bar.

## 1. Backend Coverage Collection

Add `pytest-cov` and configure pytest to emit coverage reports.

### Acceptance Criteria

- [ ] `pytest-cov` added as a dev dependency in `pyproject.toml`
- [ ] `pytest` invocation in CI produces an XML coverage report (`backend/coverage.xml`)
- [ ] Coverage collects from `app/` source, excludes `tests/`, `alembic/`
- [ ] `npm run` / `make` / direct command works locally: `poetry run pytest --cov=app --cov-report=xml`

## 2. Frontend Coverage Collection

Enable Jest coverage output in CI.

### Acceptance Criteria

- [ ] CI step runs `jest --coverage --coverageReporters=lcov` (or equivalent producing `lcov.info`)
- [ ] Coverage report written to `frontend/coverage/lcov.info`
- [ ] Existing `collectCoverageFrom` config in `jest.config.js` is used (covers `src/**/*.{ts,vue}`, excludes `main.ts` and `.d.ts`)
- [ ] Local `npm run test:coverage` continues to work

## 3. diff-cover Integration

Add a CI step that checks patch coverage against the PR's base branch.

### Acceptance Criteria

- [ ] `diff-cover` installed in CI (pip install or pinned in a requirements file)
- [ ] Frontend step: `diff-cover frontend/coverage/lcov.info --compare-branch=origin/main --fail-under=80`
- [ ] Backend step: `diff-cover backend/coverage.xml --compare-branch=origin/main --fail-under=80`
- [ ] CI job fails (blocks merge) if either frontend or backend patch coverage < 80%
- [ ] Coverage check is skipped when no source files changed in that area (respects existing `dorny/paths-filter`)
- [ ] diff-cover output is visible in the GH Actions log for debugging

## 4. CI Workflow Updates

Modify `.github/workflows/ci.yml` to wire everything together.

### Acceptance Criteria

- [ ] Backend job runs pytest with coverage and diff-cover check
- [ ] Frontend unit test job runs jest with coverage and diff-cover check
- [ ] Coverage artifacts (XML/lcov) uploaded as GH Actions artifacts for debugging
- [ ] No change to E2E test job (Playwright does not contribute to unit coverage)
- [ ] CI passes on `main` branch (no false failures when there's no diff)

## 5. Developer Experience

Make it easy for developers to check coverage locally before pushing.

### Acceptance Criteria

- [ ] `frontend/package.json` retains `test:coverage` script
- [ ] Backend equivalent documented: `poetry run pytest --cov=app --cov-report=html`
- [ ] `.gitignore` updated to exclude coverage output dirs (`coverage/`, `htmlcov/`, `*.coverage`)

## 6. Identify Coverage Gaps (Post-Setup)

Once coverage reporting is live, analyze the first report to identify high-value untested areas.

### Acceptance Criteria

- [ ] Run full coverage report locally for frontend and backend
- [ ] Document top uncovered files/modules ranked by line count
- [ ] Create follow-up tickets for highest-impact coverage gaps (stores, composables, services, API routes)

## Technical Design

### diff-cover

`diff-cover` is a Python CLI tool that reads standard coverage formats (Cobertura XML, lcov) and cross-references with `git diff` to report coverage on changed lines only.

```
pip install diff-cover
diff-cover coverage.xml --compare-branch=origin/main --fail-under=80
```

Exit code 2 = coverage below threshold (CI fails). Exit code 0 = pass.

### CI Flow

```
PR opened
  ├─ paths-filter (existing)
  ├─ backend (if backend/** changed)
  │   ├─ poetry install
  │   ├─ pytest --cov=app --cov-report=xml
  │   ├─ pip install diff-cover
  │   └─ diff-cover coverage.xml --compare-branch=origin/main --fail-under=80
  ├─ frontend-lint (existing, unchanged)
  ├─ frontend-unit-tests (if frontend/** changed)
  │   ├─ npm install
  │   ├─ jest --coverage
  │   ├─ pip install diff-cover
  │   └─ diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=80
  └─ frontend-e2e (existing, unchanged)
```

### Edge Cases

- **No changed lines in source**: diff-cover reports 100% (pass) — no action needed
- **Only deletions**: No lines to cover — pass
- **New files with 0 tests**: Will fail if >20% of lines uncovered — intended behavior
- **Main branch builds**: diff-cover compares HEAD~1 or skipped entirely (only runs on PRs)

## Rollout

1. Add coverage collection (sections 1-2) — non-blocking, just produces reports
2. Add diff-cover gating (section 3-4) — starts blocking PRs
3. Run gap analysis (section 6) — informs follow-up work
