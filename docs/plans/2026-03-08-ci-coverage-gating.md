# CI Coverage Gating Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add coverage collection to both frontend (Jest) and backend (pytest), then gate PRs on 80% patch coverage using diff-cover.

**Architecture:** Coverage reports are generated during existing test steps (XML for backend, lcov for frontend). A new `diff-cover` step in each CI job compares coverage against `origin/main` and fails if changed lines are <80% covered. No external services needed.

**Tech Stack:** pytest-cov, diff-cover, Jest --coverage, GitHub Actions

**Spec:** `docs/specs/ci-coverage-gating.md`

**Worktree:** `.worktrees/ci-coverage-gating/` (branch: `feat/ci-coverage-gating`)

---

### Task 1: Add pytest-cov to backend

**Files:**
- Modify: `backend/pyproject.toml:31-35` (dev dependencies)

**Step 1: Add pytest-cov dependency**

In `backend/pyproject.toml`, add `pytest-cov` to `[tool.poetry.group.dev.dependencies]`:

```toml
[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
pytest-asyncio = "^0.24"
pytest-cov = "^6.0"
ruff = "^0.8"
mypy = "^1.13"
```

**Step 2: Install the new dependency**

Run: `cd backend && poetry add --group dev pytest-cov`

**Step 3: Verify coverage works locally**

Run: `cd backend && poetry run pytest --cov=app --cov-report=xml --cov-report=term-missing`
Expected: All 161 tests pass, `coverage.xml` created in `backend/`, terminal shows coverage summary.

**Step 4: Commit**

```bash
git add backend/pyproject.toml backend/poetry.lock
git commit -m "chore: add pytest-cov to backend dev dependencies"
```

---

### Task 2: Add diff-cover to backend

**Files:**
- Modify: `backend/pyproject.toml:31-35` (dev dependencies)

**Step 1: Add diff-cover dependency**

In `backend/pyproject.toml`, add `diff-cover` to `[tool.poetry.group.dev.dependencies]`:

```toml
[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
pytest-asyncio = "^0.24"
pytest-cov = "^6.0"
diff-cover = "^9.0"
ruff = "^0.8"
mypy = "^1.13"
```

**Step 2: Install the new dependency**

Run: `cd backend && poetry add --group dev diff-cover`

**Step 3: Verify diff-cover works locally**

Run: `cd backend && poetry run diff-cover coverage.xml --compare-branch=main --fail-under=80`
Expected: Reports coverage on changed lines (or "No lines with coverage" if no diff from main).

**Step 4: Commit**

```bash
git add backend/pyproject.toml backend/poetry.lock
git commit -m "chore: add diff-cover to backend dev dependencies"
```

---

### Task 3: Update .gitignore for coverage artifacts

**Files:**
- Modify: `.gitignore`

**Step 1: Verify current state**

The `.gitignore` already has:
```
htmlcov/
.coverage
coverage/
```

Add `coverage.xml` (backend pytest-cov output) and `*.lcov`:

```
# Coverage
htmlcov/
.coverage
coverage/
coverage.xml
*.lcov
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add coverage.xml and lcov to .gitignore"
```

---

### Task 4: Update CI backend job with coverage + diff-cover

**Files:**
- Modify: `.github/workflows/ci.yml:30-60` (backend job)

**Step 1: Replace the backend Test step and add coverage gate**

Replace lines 59-60:
```yaml
      - name: Test
        run: cd backend && poetry run pytest
```

With:
```yaml
      - name: Test with coverage
        run: cd backend && poetry run pytest --cov=app --cov-report=xml --cov-report=term-missing

      - name: Check patch coverage
        run: cd backend && poetry run diff-cover coverage.xml --compare-branch=origin/main --fail-under=80

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: backend-coverage
          path: backend/coverage.xml
          retention-days: 7
```

**Step 2: Add full checkout depth for diff-cover**

The `actions/checkout@v4` step in the backend job needs `fetch-depth: 0` so diff-cover can compare against `origin/main`. Replace:
```yaml
      - uses: actions/checkout@v4
```
With:
```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add backend coverage collection and diff-cover gate"
```

---

### Task 5: Update CI frontend-unit-tests job with coverage + diff-cover

**Files:**
- Modify: `.github/workflows/ci.yml:87-102` (frontend-unit-tests job)

**Step 1: Add full checkout depth**

Replace the checkout step in `frontend-unit-tests`:
```yaml
      - uses: actions/checkout@v4
```
With:
```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

**Step 2: Replace the Unit tests step and add coverage gate**

Replace lines 101-102:
```yaml
      - name: Unit tests
        run: cd frontend && npm test
```

With:
```yaml
      - name: Unit tests with coverage
        run: cd frontend && npx jest --coverage --coverageReporters=lcov --coverageReporters=text-summary

      - name: Install diff-cover
        run: pip install diff-cover

      - name: Check patch coverage
        run: diff-cover frontend/coverage/lcov.info --compare-branch=origin/main --fail-under=80

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: frontend-coverage
          path: frontend/coverage/lcov.info
          retention-days: 7
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add frontend coverage collection and diff-cover gate"
```

---

### Task 6: Verify locally

**Step 1: Run backend coverage + diff-cover**

```bash
cd backend
poetry run pytest --cov=app --cov-report=xml --cov-report=term-missing
poetry run diff-cover coverage.xml --compare-branch=main --fail-under=80
```

Expected: Tests pass, diff-cover reports on changed lines.

**Step 2: Run frontend coverage + diff-cover**

```bash
cd frontend
npx jest --coverage --coverageReporters=lcov --coverageReporters=text-summary
pip install diff-cover  # if not already installed
diff-cover coverage/lcov.info --compare-branch=main --fail-under=80
```

Expected: Tests pass, diff-cover reports on changed lines.

**Step 3: Validate CI YAML syntax**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: No errors.

---

### Task 7: Copy spec to worktree and final commit

**Step 1: Copy the spec file**

The spec was created in the main worktree. Copy it:

```bash
cp docs/specs/ci-coverage-gating.md .worktrees/ci-coverage-gating/docs/specs/ci-coverage-gating.md
```

Wait — the spec is already at `docs/specs/ci-coverage-gating.md` in the main worktree. It needs to be committed in this branch too. The file should already exist if it was created before the worktree branched. Check and create if needed.

**Step 2: Final commit with spec**

```bash
git add docs/specs/ci-coverage-gating.md docs/plans/2026-03-08-ci-coverage-gating.md
git commit -m "docs: add coverage gating spec and implementation plan"
```
