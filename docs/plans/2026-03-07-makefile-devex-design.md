# Makefile DevEx Overhaul Design

**Date:** 2026-03-07
**Status:** Implemented

## Goal

Replace the minimal Makefile with a comprehensive, self-documenting developer experience Makefile. Docker Compose is the primary dev workflow.

## Approach

Enhanced Makefile with self-documenting `make help` (default target) using `## comment` parsing pattern. Targets organized by category.

## Target Inventory

### Setup
- `setup` — Install backend (poetry install) + frontend (npm install) dependencies
- `env` — Copy `.env.example` → `.env` if missing

### Development
- `dev` — `docker compose up --build`
- `dev-detached` — `docker compose up --build -d`
- `stop` — `docker compose down`
- `restart` — stop + dev
- `restart-backend` — `docker compose restart backend`
- `restart-frontend` — `docker compose restart frontend`
- `status` — `docker compose ps`

### Logs
- `logs` — `docker compose logs -f` (all)
- `logs-backend` — `docker compose logs -f backend`
- `logs-frontend` — `docker compose logs -f frontend`
- `logs-db` — `docker compose logs -f postgres`

### Testing
- `test` — All tests
- `test-backend` — pytest
- `test-frontend` — vue type-check

### Linting & Formatting
- `lint` — All linters
- `lint-backend` — ruff check + mypy
- `lint-frontend` — eslint
- `format` — Auto-format all
- `format-backend` — ruff format + ruff check --fix
- `format-frontend` — eslint --fix
- `check` — lint + test (CI parity)

### Database
- `migrate` — Alembic upgrade head
- `seed` — Run seed script
- `db-reset` — Drop volumes, recreate, migrate, seed
- `db-shell` — psql into running postgres

### Shell Access
- `shell-backend` — bash into backend container
- `shell-frontend` — sh into frontend container

### Docker & Build
- `build` — `docker compose build`
- `docker-build` — Build tagged local images

### Helm
- `helm-lint` — Lint charts (default + production values)

### Cleanup
- `clean` — `docker compose down -v --remove-orphans`
- `clean-all` — clean + remove node_modules, __pycache__, .ruff_cache, dist, etc.

## Help System

Self-documenting via `## comment` pattern:

```makefile
target: ## Help text here
```

Default `make` target runs `help`, which greps for `##` comments and prints categorized output using section headers (`##@`).
