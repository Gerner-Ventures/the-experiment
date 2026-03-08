.DEFAULT_GOAL := help

# Neon config
NEON_PROJECT_ID := aged-salad-35688646
NEON_ORG_ID := org-jolly-haze-41433858
NEON_PARENT_BRANCH := main
NEON_DB_NAME := neondb
NEON_ROLE := neondb_owner
NEON_BRANCH_TTL_DAYS := 7
BRANCH_NAME ?= $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
NEON_EXPIRES_AT ?= $(shell python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()+timedelta(days=$(NEON_BRANCH_TTL_DAYS))).strftime('%Y-%m-%dT%H:%M:%SZ'))")

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
	@if [ -f backend/.env ]; then \
		echo "backend/.env already exists"; \
	else \
		cp backend/.env.example backend/.env && echo "Created backend/.env from .env.example"; \
	fi

# ============================================================================
# Development
# ============================================================================

##@ Development (Docker)

.PHONY: dev dev-detached stop restart restart-backend restart-frontend status

dev: ## Start all services via docker compose
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
# Local Development (Doppler + Neon branch)
# ============================================================================

##@ Local Development

.PHONY: dev-local dev-backend dev-frontend dev-redis

dev-local: dev-redis dev-backend dev-frontend ## Start backend + frontend locally with Doppler secrets

dev-backend: ## Start backend locally (Doppler + Neon branch DB)
	cd backend && doppler run -p the-experiment -c dev -- poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev-frontend: ## Start frontend dev server
	cd frontend && npm run dev

dev-redis: ## Start local Redis via Docker (background)
	@docker start the-experiment-redis 2>/dev/null || docker run -d --name the-experiment-redis -p 6379:6379 redis:7-alpine
	@echo "Redis running on localhost:6379"

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

.PHONY: lint lint-backend lint-frontend format format-backend format-frontend check build-frontend

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Run ruff check + mypy
	cd backend && poetry run ruff check . && poetry run mypy app

lint-frontend: ## Run ESLint
	cd frontend && npm run lint

format: format-backend format-frontend ## Auto-format all code

format-backend: ## Auto-format backend (ruff)
	cd backend && poetry run ruff format . && poetry run ruff check --fix .

format-frontend: ## Auto-format frontend (ESLint --fix)
	cd frontend && npx eslint --fix .

check: lint test build-frontend helm-lint ## Run all checks (CI parity)

build-frontend: ## Build frontend for production
	cd frontend && npm run build

# ============================================================================
# Database
# ============================================================================

##@ Database (Docker)

.PHONY: migrate seed db-reset db-shell

migrate: ## Run database migrations (alembic upgrade head)
	cd backend && doppler run -p the-experiment -c dev -- poetry run alembic upgrade head

seed: ## Seed the database
	cd backend && doppler run -p the-experiment -c dev -- poetry run python -m app.db.seed

db-reset: ## Reset local Docker database (destroy + recreate + migrate + seed)
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
# Neon Branch Database
# ============================================================================

##@ Neon Branches

.PHONY: neon-create neon-delete neon-list neon-url neon-migrate

neon-create: ## Create a Neon branch for current git branch (from prod, 7-day TTL)
	@echo "Creating Neon branch '$(BRANCH_NAME)' from $(NEON_PARENT_BRANCH) (expires $(NEON_EXPIRES_AT))..."
	@npx neonctl branches create \
		--project-id $(NEON_PROJECT_ID) \
		--org-id $(NEON_ORG_ID) \
		--name $(BRANCH_NAME) \
		--parent $(NEON_PARENT_BRANCH) \
		--expires-at $(NEON_EXPIRES_AT) && \
	FULL_URL=$$(npx neonctl connection-string \
		--project-id $(NEON_PROJECT_ID) \
		--org-id $(NEON_ORG_ID) \
		--branch $(BRANCH_NAME) \
		--database-name $(NEON_DB_NAME) \
		--role-name $(NEON_ROLE)) && \
	ASYNC_URL=$$(echo "$$FULL_URL" | sed 's|postgresql://|postgresql+asyncpg://|' | sed 's|?.*||')'?ssl=require' && \
	doppler secrets set DATABASE_URL="$$ASYNC_URL" --project the-experiment --config dev && \
	echo "Neon branch '$(BRANCH_NAME)' created and DATABASE_URL updated in Doppler dev config."

neon-delete: ## Delete the Neon branch for current git branch
	@echo "Deleting Neon branch '$(BRANCH_NAME)'..."
	@npx neonctl branches delete $(BRANCH_NAME) \
		--project-id $(NEON_PROJECT_ID) \
		--org-id $(NEON_ORG_ID) && \
	echo "Neon branch '$(BRANCH_NAME)' deleted."

neon-list: ## List all Neon branches
	@npx neonctl branches list \
		--project-id $(NEON_PROJECT_ID) \
		--org-id $(NEON_ORG_ID)

neon-url: ## Show the connection string for current branch
	@npx neonctl connection-string \
		--project-id $(NEON_PROJECT_ID) \
		--org-id $(NEON_ORG_ID) \
		--branch $(BRANCH_NAME) \
		--database-name $(NEON_DB_NAME) \
		--role-name $(NEON_ROLE)

neon-migrate: ## Run alembic migrations against the Neon branch DB
	cd backend && doppler run -p the-experiment -c dev -- poetry run alembic upgrade head

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

helm-lint: ## Lint Helm charts (default + production + local values)
	helm lint chart/the-experiment/
	helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml
	helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml

# ============================================================================
# Local Kubernetes (DevSpace)
# ============================================================================

##@ Local Kubernetes

.PHONY: local-up local-dev local-down local-status local-logs local-db-shell

local-up: ## Deploy to local k8s (build + deploy, no sync)
	devspace deploy

local-dev: ## Start local k8s dev mode (build + deploy + sync + port-forward)
	devspace dev

local-down: ## Tear down local k8s deployment
	devspace purge

local-status: ## Show pods in the-experiment namespace
	kubectl get pods -n the-experiment

local-logs: ## Tail all pod logs in the-experiment namespace
	kubectl logs -n the-experiment -l app.kubernetes.io/instance=the-experiment --all-containers -f

local-db-shell: ## Open psql shell to local k8s postgres
	kubectl exec -it -n the-experiment statefulset/the-experiment-postgres -- psql -U experiment experiment

# ============================================================================
# Canon (Spec-Driven Development)
# ============================================================================

##@ Canon

CANON_REPO ?= Gerner-Ventures/gv-exp-specwright
CANON_LOCAL ?= $(abspath ../gv-exp-specwright)
CANON_URL ?= https://specwright.gernerventures.com

.PHONY: canon-setup canon-plugin canon-status

canon-setup: canon-plugin ## Install Canon CLI + Claude plugin + authenticate
	@command -v uv >/dev/null 2>&1 || { echo "Error: uv not found. Install: https://docs.astral.sh/uv/"; exit 1; }
	@command -v canon >/dev/null 2>&1 || { echo "Installing Canon CLI from $(CANON_LOCAL)..."; uv tool install --from "$(CANON_LOCAL)" canonhq; }
	@echo "Checking Canon auth..."
	@CANON_URL=$(CANON_URL) canon auth status 2>/dev/null | grep -q "valid" \
		|| { echo "Logging in to Canon..."; CANON_URL=$(CANON_URL) canon login --server $(CANON_URL) \
		|| echo "Warning: Auth failed (server unreachable?). Canon works locally without auth. Run 'canon login --server $(CANON_URL)' later."; }
	@echo "Canon setup complete. Restart Claude Code to load the plugin."

canon-plugin: ## Install Canon Claude plugin (requires clone of specwright repo)
	@command -v claude >/dev/null 2>&1 || { echo "Error: Claude Code CLI not found. Install Claude Code first."; exit 1; }
	@if [ ! -d "$(CANON_LOCAL)" ]; then \
		echo "Canon repo not found at $(CANON_LOCAL)"; \
		echo "Clone it first:"; \
		echo "  git clone git@github.com:$(CANON_REPO).git $(CANON_LOCAL)"; \
		exit 1; \
	fi
	@# TODO: remove branch fallback after feat/canon-rebrand is merged to main
	@if [ ! -f "$(CANON_LOCAL)/.claude-plugin/marketplace.json" ]; then \
		echo "Checking out Canon plugin branch..."; \
		git -C "$(CANON_LOCAL)" fetch origin 2>/dev/null; \
		git -C "$(CANON_LOCAL)" checkout feat/canon-rebrand 2>/dev/null || git -C "$(CANON_LOCAL)" checkout main; \
	fi
	@echo "Registering Canon marketplace..."
	@claude plugin marketplace add "$(CANON_LOCAL)"
	@echo "Installing Canon plugin..."
	@claude plugin install canon@canon --scope project
	@echo "Done. Restart Claude Code to load the plugin."

canon-status: ## Show Canon spec coverage for this project
	@command -v canon >/dev/null 2>&1 || { echo "Error: Canon not installed. Run: make canon-setup"; exit 1; }
	@canon status

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
