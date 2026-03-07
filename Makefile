.PHONY: dev stop build test lint migrate seed clean helm-lint docker-build

# Local development
dev:
	docker compose up --build

stop:
	docker compose down

# Build
build:
	docker compose build

# Testing
test-backend:
	cd backend && poetry run pytest

test-frontend:
	cd frontend && npm run type-check

test: test-backend test-frontend

# Linting
lint-backend:
	cd backend && poetry run ruff check . && poetry run mypy app

lint-frontend:
	cd frontend && npm run lint

lint: lint-backend lint-frontend

# Database
migrate:
	cd backend && poetry run alembic upgrade head

seed:
	cd backend && poetry run python -m app.db.seed

# Cleanup
clean:
	docker compose down -v --remove-orphans

# Helm
helm-lint:
	helm lint chart/the-experiment/
	helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml

# Docker build (local)
docker-build:
	docker build -t the-experiment-backend:local ./backend
	docker build -t the-experiment-frontend:local ./frontend
