# Local Kubernetes Postgres + DevSpace Setup

**Date:** 2026-03-07
**Branch:** codex/pr33-runtime-persistence
**Status:** Approved

## Context

PR #34 (`codex/pr33-runtime-persistence`) adds Postgres persistence to the backend via SQLAlchemy + Alembic. Production uses Neon (managed Postgres). The Helm chart currently has no local Postgres, and there is no DevSpace configuration for local k8s development.

## Goals

1. Add Postgres as a toggleable component in the Helm chart for local k8s dev
2. Add DevSpace configuration for local development with hot reload
3. Merge main into the PR branch to pick up latest changes
4. Verify the full stack works locally

## Design

### 1. Postgres in Helm Chart

**New templates:**
- `postgres-statefulset.yaml` — Postgres 16-alpine StatefulSet with 1Gi PVC, health checks
- `postgres-service.yaml` — ClusterIP on port 5432

**Values additions (`values.yaml`):**
```yaml
postgres:
  enabled: false        # prod uses Neon
  image: postgres:16-alpine
  storage: 1Gi
  database: experiment
  user: experiment
  password: experiment
  resources:
    limits: { memory: 256Mi }
    requests: { cpu: 100m, memory: 128Mi }
```

**DATABASE_URL wiring:** `_helpers.tpl` gets a `postgresUrl` helper that auto-generates `postgresql+asyncpg://experiment:experiment@{fullname}-postgres:5432/experiment` when `postgres.enabled=true`. The backend deployment uses this via a local postgres secret or configmap override.

**Migration init-container:** Backend deployment gets an optional init container (gated on `postgres.enabled`) that runs `alembic upgrade head` before the app starts.

### 2. DevSpace Configuration

**`devspace.yaml`** at repo root wraps the Helm chart with dev overrides.

**Images:** Builds backend and frontend locally with `pullPolicy: Never` (Docker Desktop loads images directly).

**Deployments:** Single Helm deployment using `chart/the-experiment/` with `values-local.yaml` overlay.

**Dev mode (`devspace dev`):**
- Backend: file sync `./backend` → `/app`, uvicorn `--reload`, port-forward 8000
- Frontend: file sync `./frontend/src` → `/app/src`, vite dev with HMR, port-forward 5173
- Postgres: port-forward 5432 for direct access
- Redis: port-forward 6379

**Hooks:**
- Post-deploy: runs `alembic upgrade head` in backend container

### 3. values-local.yaml

```yaml
postgres:
  enabled: true

backend:
  image:
    repository: the-experiment-backend
    tag: dev
    pullPolicy: Never

frontend:
  image:
    repository: the-experiment-frontend
    tag: dev
    pullPolicy: Never

secrets:
  neon:
    databaseUrl: "postgresql+asyncpg://experiment:experiment@the-experiment-postgres:5432/experiment"

podSecurityContext:
  runAsNonRoot: false
  runAsUser: 0
  runAsGroup: 0
  fsGroup: 0

securityContext:
  readOnlyRootFilesystem: false
  allowPrivilegeEscalation: false
```

### 4. Makefile Targets

```
make local-up       # devspace deploy
make local-dev      # devspace dev (sync + port forward)
make local-down     # devspace purge
make local-status   # kubectl get pods
```

### 5. Workflow

1. `make local-dev` — builds images, deploys to local k8s with Postgres, syncs files, forwards ports
2. Backend at localhost:8000, frontend at localhost:5173, Postgres at localhost:5432
3. Code changes hot-reload via file sync
4. `make local-down` to tear down

docker-compose.yml stays as-is for quick dev. DevSpace gives k8s-native local stack mirroring prod.
