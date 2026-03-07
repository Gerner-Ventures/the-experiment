# Makefile DevEx Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the minimal Makefile with a comprehensive, self-documenting Makefile covering setup, dev, testing, linting, formatting, logs, database, shell access, and cleanup.

**Architecture:** Single Makefile rewrite using the `##` comment self-documenting pattern with `##@` section headers. All dev workflow is Docker Compose-based.

**Tech Stack:** GNU Make, Docker Compose, Poetry (backend), npm (frontend), ruff, mypy, ESLint, Alembic, psql

---

### Task 1: Write the new Makefile

**Files:**
- Modify: `Makefile` (full rewrite)

**Step 1: Replace the Makefile with the new version**

Write this exact content to `Makefile`:

```makefile
.DEFAULT_GOAL := help

# ============================================================================
# Help
# ============================================================================

.PHONY: help
help: ## Show this help message
	@echo "Usage: make <target>"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; section=""} \
		/^##@/ { section=substr($$0, 5); next } \
		/^[a-zA-Z_-]+:.*?##/ { \
			if (section != "") { printf "\n\033[1m%s:\033[0m\n", section; section="" } \
			printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 \
		}' $(MAKEFILE_LIST)
	@echo ""

# ============================================================================
# Setup
# ============================================================================

##@ Setup

.PHONY: setup env

setup: ## Install all dependencies (backend + frontend)
	cd backend && poetry install
	cd frontend && npm install

env: ## Copy .env.example to backend/.env if missing
	@test -f backend/.env || (cp backend/.env.example backend/.env && echo "Created backend/.env from .env.example") || echo "backend/.env already exists"

# ============================================================================
# Development
# ============================================================================

##@ Development

.PHONY: dev dev-detached stop restart restart-backend restart-frontend status

dev: ## Start all services (docker compose up --build)
	docker compose up --build

dev-detached: ## Start all services in background
	docker compose up --build -d

stop: ## Stop all services
	docker compose down

restart: ## Restart all services (stop + start)
	docker compose down
	docker compose up --build -d

restart-backend: ## Restart only the backend service
	docker compose restart backend

restart-frontend: ## Restart only the frontend service
	docker compose restart frontend

status: ## Show running container status
	docker compose ps

# ============================================================================
# Logs
# ============================================================================

##@ Logs

.PHONY: logs logs-backend logs-frontend logs-db

logs: ## Tail logs for all services
	docker compose logs -f

logs-backend: ## Tail logs for backend
	docker compose logs -f backend

logs-frontend: ## Tail logs for frontend
	docker compose logs -f frontend

logs-db: ## Tail logs for postgres
	docker compose logs -f postgres

# ============================================================================
# Testing
# ============================================================================

##@ Testing

.PHONY: test test-backend test-frontend

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests (pytest)
	cd backend && poetry run pytest

test-frontend: ## Run frontend type-check
	cd frontend && npm run type-check

# ============================================================================
# Linting & Formatting
# ============================================================================

##@ Linting & Formatting

.PHONY: lint lint-backend lint-frontend format format-backend format-frontend check

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Run ruff check + mypy
	cd backend && poetry run ruff check . && poetry run mypy app

lint-frontend: ## Run ESLint
	cd frontend && npm run lint

format: format-backend format-frontend ## Auto-format all code

format-backend: ## Auto-format backend (ruff)
	cd backend && poetry run ruff format . && poetry run ruff check --fix .

format-frontend: ## Auto-format frontend (ESLint --fix)
	cd frontend && npx eslint --fix src/

check: lint test ## Run all linters and tests (CI parity)

# ============================================================================
# Database
# ============================================================================

##@ Database

.PHONY: migrate seed db-reset db-shell

migrate: ## Run database migrations (alembic upgrade head)
	cd backend && poetry run alembic upgrade head

seed: ## Seed the database
	cd backend && poetry run python -m app.db.seed

db-reset: ## Reset database (destroy + recreate + migrate + seed)
	docker compose down -v --remove-orphans
	docker compose up -d postgres redis
	@echo "Waiting for postgres to be ready..."
	@until docker compose exec postgres pg_isready -U experiment > /dev/null 2>&1; do sleep 1; done
	cd backend && poetry run alembic upgrade head
	cd backend && poetry run python -m app.db.seed
	@echo "Database reset complete."

db-shell: ## Open psql shell to the database
	docker compose exec postgres psql -U experiment experiment

# ============================================================================
# Shell Access
# ============================================================================

##@ Shell Access

.PHONY: shell-backend shell-frontend

shell-backend: ## Open a bash shell in the backend container
	docker compose exec backend bash

shell-frontend: ## Open a shell in the frontend container
	docker compose exec frontend sh

# ============================================================================
# Docker & Build
# ============================================================================

##@ Docker & Build

.PHONY: build docker-build

build: ## Build all Docker images
	docker compose build

docker-build: ## Build production Docker images (tagged :local)
	docker build -t the-experiment-backend:local ./backend
	docker build -t the-experiment-frontend:local ./frontend

# ============================================================================
# Helm
# ============================================================================

##@ Helm

.PHONY: helm-lint

helm-lint: ## Lint Helm charts (default + production values)
	helm lint chart/the-experiment/
	helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml

# ============================================================================
# Cleanup
# ============================================================================

##@ Cleanup

.PHONY: clean clean-all

clean: ## Stop services and remove volumes
	docker compose down -v --remove-orphans

clean-all: clean ## Full cleanup (volumes + caches + build artifacts)
	rm -rf frontend/node_modules frontend/dist
	find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf backend/.ruff_cache backend/.mypy_cache
	@echo "All clean."
```

**Step 2: Verify help output works**

Run: `make help`
Expected: Categorized help output with all targets listed under section headers.

**Step 3: Spot-check a few targets**

Run: `make status`
Expected: Docker Compose ps output (may show no running containers, that's fine).

**Step 4: Commit**

```bash
git add Makefile
git commit -m "feat: overhaul Makefile with comprehensive devex commands

Add self-documenting help system, formatting, log tailing, db-reset,
shell access, clean-all, and dev-detached targets."
```

---

### Task 2: Update design doc status

**Files:**
- Modify: `docs/plans/2026-03-07-makefile-devex-design.md`

**Step 1: Update status to Implemented**

Change `**Status:** Approved` to `**Status:** Implemented`

**Step 2: Commit**

```bash
git add docs/plans/2026-03-07-makefile-devex-design.md
git commit -m "docs: mark makefile devex design as implemented"
```
