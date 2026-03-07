.PHONY: dev stop build test lint migrate seed clean

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
