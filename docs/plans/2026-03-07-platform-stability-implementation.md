# Platform Stability Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the production Kubernetes deployment to prevent outages, control costs, and add observability via PostHog.

**Architecture:** Three tiers of changes — (1) critical fixes to migration, deploy pipeline, ingress; (2) production hardening of deployment strategy, resource limits, security contexts; (3) PostHog observability in both backend and frontend. All changes target the existing Helm chart, Dockerfiles, and FastAPI backend.

**Tech Stack:** Helm 3, FastAPI, SQLAlchemy/Alembic, nginx-ingress, PostHog (posthog-python, posthog-js), GitHub Actions, Terraform (gv-infra)

---

## Tier 1 — Stop the Bleeding

### Task 1: Fix Alembic Migration Enum Bug

The first migration explicitly creates enums then `op.create_table()` tries to create them again. Fix by adding `create_type=False` to each `sa.Enum()` so only the explicit `.create()` calls handle enum lifecycle.

**Files:**
- Modify: `backend/alembic/versions/20260306_000001_create_initial_models.py:21-28`

**Step 1: Add `create_type=False` to all four enum definitions**

Change lines 21-28 from:

```python
experiment_status = sa.Enum(
    "setup", "running", "paused", "completed", "collapsed", name="experiment_status"
)
agent_status = sa.Enum(
    "idle", "thinking", "talking", "moving", "working", "sneaking", "exiled", name="agent_status"
)
resource_pressure = sa.Enum("low", "medium", "high", "critical", name="resource_pressure")
event_type = sa.Enum("round", "action", "social", "crisis", "system", name="event_type")
```

To:

```python
experiment_status = sa.Enum(
    "setup", "running", "paused", "completed", "collapsed", name="experiment_status",
    create_type=False,
)
agent_status = sa.Enum(
    "idle", "thinking", "talking", "moving", "working", "sneaking", "exiled", name="agent_status",
    create_type=False,
)
resource_pressure = sa.Enum(
    "low", "medium", "high", "critical", name="resource_pressure", create_type=False,
)
event_type = sa.Enum(
    "round", "action", "social", "crisis", "system", name="event_type", create_type=False,
)
```

The explicit `.create(bind, checkfirst=True)` calls on lines 33-36 remain unchanged — they handle creation. The explicit `.drop(bind, checkfirst=True)` calls in `downgrade()` on lines 270-273 also remain unchanged.

**Step 2: Verify the fix works**

Run: `cd backend && poetry run python -c "from alembic.versions import *; print('imports ok')"`

This is a syntax check. Full migration testing requires a database — the real validation happens at deploy time when the init container runs `alembic upgrade head`.

**Step 3: Commit**

```bash
git add backend/alembic/versions/20260306_000001_create_initial_models.py
git commit -m "fix: add create_type=False to alembic enums to prevent duplicate creation"
```

---

### Task 2: Add `--atomic` to Helm Deploy and Add `revisionHistoryLimit`

**Files:**
- Modify: `.github/workflows/deploy.yml:124-129`
- Modify: `chart/the-experiment/templates/backend-deployment.yaml:12-13`
- Modify: `chart/the-experiment/templates/frontend-deployment.yaml:10-11`

**Step 1: Add `--atomic` flag to the Helm upgrade command**

In `.github/workflows/deploy.yml`, change lines 124-129 from:

```yaml
          helm upgrade --install the-experiment chart/the-experiment/ \
            -f chart/the-experiment/values-production.yaml \
            --set backend.image.tag="${IMAGE_TAG}" \
            --set frontend.image.tag="${IMAGE_TAG}" \
            -n the-experiment --create-namespace \
            --wait --timeout 5m
```

To:

```yaml
          helm upgrade --install the-experiment chart/the-experiment/ \
            -f chart/the-experiment/values-production.yaml \
            --set backend.image.tag="${IMAGE_TAG}" \
            --set frontend.image.tag="${IMAGE_TAG}" \
            -n the-experiment --create-namespace \
            --atomic --timeout 5m
```

Note: `--atomic` implies `--wait`, so `--wait` is removed as redundant.

**Step 2: Add `revisionHistoryLimit: 3` to backend Deployment**

In `chart/the-experiment/templates/backend-deployment.yaml`, change lines 12-13 from:

```yaml
  strategy:
    type: Recreate
```

To:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: Recreate
```

**Step 3: Add `revisionHistoryLimit: 3` to frontend Deployment**

In `chart/the-experiment/templates/frontend-deployment.yaml`, change lines 10-11 from:

```yaml
  strategy:
    type: Recreate
```

To:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: Recreate
```

**Step 4: Lint the chart**

Run: `helm lint chart/the-experiment/ && helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`

Expected: Both pass with 0 failures.

**Step 5: Commit**

```bash
git add .github/workflows/deploy.yml chart/the-experiment/templates/backend-deployment.yaml chart/the-experiment/templates/frontend-deployment.yaml
git commit -m "fix: add --atomic helm deploy and revisionHistoryLimit to prevent stale state"
```

---

### Task 3: Add Rate Limiting and SSL Redirect to Ingress

**Files:**
- Modify: `chart/the-experiment/templates/ingress.yaml:8-14`
- Modify: `chart/the-experiment/values-production.yaml:18-24`

**Step 1: Add rate limiting and security annotations to production values**

In `chart/the-experiment/values-production.yaml`, change lines 18-24 from:

```yaml
ingress:
  enabled: true
  className: nginx
  hostname: the-experiment.gernerventures.com
  tls: true
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-production
```

To:

```yaml
ingress:
  enabled: true
  className: nginx
  hostname: the-experiment.gernerventures.com
  tls: true
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-production
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/hsts: "true"
    nginx.ingress.kubernetes.io/hsts-max-age: "31536000"
    nginx.ingress.kubernetes.io/hsts-include-subdomains: "true"
    nginx.ingress.kubernetes.io/limit-rps: "10"
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
    nginx.ingress.kubernetes.io/limit-connections: "5"
```

The template at `ingress.yaml:9-11` already renders `{{ .Values.ingress.annotations }}` so no template changes needed.

**Step 2: Lint**

Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`

Expected: Pass.

**Step 3: Commit**

```bash
git add chart/the-experiment/values-production.yaml
git commit -m "feat: add rate limiting, SSL redirect, and HSTS to production ingress"
```

---

### Task 4: Add Deep Readiness Probe

**Files:**
- Modify: `backend/app/api/routes/health.py`
- Modify: `backend/app/core/config.py` (add `posthog_key` setting — needed later for Tier 3, but the field should exist now)
- Modify: `chart/the-experiment/templates/backend-deployment.yaml:89-96`

**Step 1: Add readiness endpoint to health routes**

Replace the entire contents of `backend/app/api/routes/health.py` with:

```python
from __future__ import annotations

import redis.asyncio as aioredis
from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings

router = APIRouter(tags=["health"])

settings = get_settings()


@router.get(
    "/health",
    summary="Liveness check",
    description="Shallow liveness probe — confirms the process is alive.",
)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get(
    "/health/ready",
    summary="Readiness check",
    description="Deep readiness probe — checks DB and Redis connectivity.",
)
async def readiness() -> dict[str, str | dict[str, str]]:
    checks: dict[str, str] = {}

    # Check database
    try:
        engine = create_async_engine(settings.database_url, pool_size=1, max_overflow=0)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await engine.dispose()
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "unreachable"

    # Check Redis
    try:
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unreachable"

    all_ok = all(v == "ok" for v in checks.values())
    if not all_ok:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "checks": checks},
        )

    return {"status": "ok", "checks": checks}
```

**Step 2: Update readiness probe in backend Deployment**

In `chart/the-experiment/templates/backend-deployment.yaml`, change lines 89-96 from:

```yaml
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 3
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
```

To:

```yaml
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
```

**Step 3: Run backend tests**

Run: `cd backend && poetry run pytest -v`

Expected: All existing tests pass (the new endpoint doesn't break anything).

**Step 4: Lint the chart**

Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`

Expected: Pass.

**Step 5: Commit**

```bash
git add backend/app/api/routes/health.py chart/the-experiment/templates/backend-deployment.yaml
git commit -m "feat: add deep readiness probe checking DB and Redis connectivity"
```

---

## Tier 2 — Production Hardening

### Task 5: Switch to RollingUpdate Strategy

**Files:**
- Modify: `chart/the-experiment/templates/backend-deployment.yaml:12-13`
- Modify: `chart/the-experiment/templates/frontend-deployment.yaml:10-11`

**Step 1: Change backend to RollingUpdate**

In `chart/the-experiment/templates/backend-deployment.yaml`, change:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: Recreate
```

To:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

**Step 2: Change frontend to RollingUpdate**

In `chart/the-experiment/templates/frontend-deployment.yaml`, change:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: Recreate
```

To:

```yaml
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

**Step 3: Lint**

Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`

Expected: Pass.

**Step 4: Commit**

```bash
git add chart/the-experiment/templates/backend-deployment.yaml chart/the-experiment/templates/frontend-deployment.yaml
git commit -m "feat: switch to RollingUpdate strategy for near-zero-downtime deploys"
```

---

### Task 6: Add CPU Limits, preStop Hook, and terminationGracePeriodSeconds

**Files:**
- Modify: `chart/the-experiment/values.yaml:11-16`
- Modify: `chart/the-experiment/values.yaml:25-30`
- Modify: `chart/the-experiment/values.yaml:36-41`
- Modify: `chart/the-experiment/values.yaml:51-56`
- Modify: `chart/the-experiment/templates/backend-deployment.yaml:52-104`

**Step 1: Add CPU limits to values.yaml**

In `chart/the-experiment/values.yaml`, change the backend resources (lines 11-16) from:

```yaml
  resources:
    limits:
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 256Mi
```

To:

```yaml
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 256Mi
```

Change the frontend resources (lines 25-30) from:

```yaml
  resources:
    limits:
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi
```

To:

```yaml
  resources:
    limits:
      cpu: 100m
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi
```

Change the redis resources (lines 36-41) from:

```yaml
  resources:
    limits:
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi
```

To:

```yaml
  resources:
    limits:
      cpu: 100m
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi
```

Change the postgres resources (lines 51-56) from:

```yaml
  resources:
    limits:
      memory: 256Mi
    requests:
      cpu: 100m
      memory: 128Mi
```

To:

```yaml
  resources:
    limits:
      cpu: 250m
      memory: 256Mi
    requests:
      cpu: 100m
      memory: 128Mi
```

**Step 2: Add preStop hook and terminationGracePeriodSeconds to backend Deployment**

In `chart/the-experiment/templates/backend-deployment.yaml`, add `terminationGracePeriodSeconds` at the pod spec level (after `securityContext`) and a `lifecycle` block to the backend container.

After line 34 (`{{- toYaml .Values.podSecurityContext | nindent 8 }}`), add:

```yaml
      terminationGracePeriodSeconds: 45
```

After line 57 (`{{- toYaml .Values.securityContext | nindent 12 }}`), add the lifecycle block to the backend container:

```yaml
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "10"]
```

**Step 3: Lint**

Run: `helm lint chart/the-experiment/ && helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`

Expected: Pass.

**Step 4: Commit**

```bash
git add chart/the-experiment/values.yaml chart/the-experiment/templates/backend-deployment.yaml
git commit -m "feat: add CPU limits, preStop drain hook, and terminationGracePeriod"
```

---

### Task 7: Harden Security Contexts for Frontend, Redis, and Postgres

**Files:**
- Modify: `chart/the-experiment/templates/frontend-deployment.yaml`
- Modify: `chart/the-experiment/templates/redis-deployment.yaml`
- Modify: `chart/the-experiment/templates/postgres-statefulset.yaml`

**Step 1: Add security context to frontend Deployment**

In `chart/the-experiment/templates/frontend-deployment.yaml`, add a security context to the frontend container. After line 31 (`imagePullPolicy: {{ .Values.frontend.image.pullPolicy }}`), add:

```yaml
          securityContext:
            runAsNonRoot: true
            runAsUser: 101
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
            seccompProfile:
              type: RuntimeDefault
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: nginx-cache
              mountPath: /var/cache/nginx
            - name: nginx-run
              mountPath: /var/run
```

And at the end of the spec (after resources), add volumes:

```yaml
      volumes:
        - name: tmp
          emptyDir: {}
        - name: nginx-cache
          emptyDir: {}
        - name: nginx-run
          emptyDir: {}
```

Also update the frontend Dockerfile to use the unprivileged nginx image. In `frontend/Dockerfile`, change:

```dockerfile
FROM nginx:alpine
```

To:

```dockerfile
FROM nginxinc/nginx-unprivileged:1.27-alpine
```

And change:

```dockerfile
EXPOSE 80
```

To:

```dockerfile
EXPOSE 8080
```

Then update the frontend Deployment container port and the frontend service. In `chart/the-experiment/templates/frontend-deployment.yaml`, change:

```yaml
              containerPort: 80
```

To:

```yaml
              containerPort: 8080
```

And update the probes to use port 8080 — they already use `port: http` which references the named port, so no change needed for probes.

Update the frontend service port target in `chart/the-experiment/templates/frontend-service.yaml` — the `targetPort: http` should already resolve correctly via the named port.

**Step 2: Add security context to Redis Deployment**

In `chart/the-experiment/templates/redis-deployment.yaml`, add a security context to the container. After line 21 (`image: {{ .Values.redis.image }}`), add:

```yaml
          securityContext:
            runAsNonRoot: true
            runAsUser: 999
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
            seccompProfile:
              type: RuntimeDefault
          volumeMounts:
            - name: redis-data
              mountPath: /data
```

After the container resources (line 37), add volumes:

```yaml
      volumes:
        - name: redis-data
          emptyDir: {}
```

**Step 3: Add security context to Postgres StatefulSet**

In `chart/the-experiment/templates/postgres-statefulset.yaml`, add a security context to the container. After line 22 (`image: {{ .Values.postgres.image }}`), add:

```yaml
          securityContext:
            runAsNonRoot: true
            runAsUser: 70
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
            seccompProfile:
              type: RuntimeDefault
```

Note: Postgres needs a writable filesystem for data directory, so no `readOnlyRootFilesystem`.

**Step 4: Add seccompProfile to backend pod security context**

In `chart/the-experiment/values.yaml`, update `podSecurityContext` (lines 124-128) from:

```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  fsGroup: 1001
```

To:

```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  fsGroup: 1001
  seccompProfile:
    type: RuntimeDefault
```

**Step 5: Lint**

Run: `helm lint chart/the-experiment/ && helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml && helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml`

Expected: All pass.

**Step 6: Commit**

```bash
git add chart/the-experiment/templates/frontend-deployment.yaml chart/the-experiment/templates/redis-deployment.yaml chart/the-experiment/templates/postgres-statefulset.yaml chart/the-experiment/values.yaml frontend/Dockerfile
git commit -m "feat: harden security contexts for frontend, redis, and postgres"
```

---

### Task 8: Pin Docker Base Images

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `frontend/Dockerfile`

**Step 1: Pin backend Dockerfile images**

In `backend/Dockerfile`, change:

```dockerfile
FROM python:3.12-slim AS build
```

To:

```dockerfile
FROM python:3.12.9-slim-bookworm AS build
```

And change:

```dockerfile
FROM python:3.12-slim
```

To:

```dockerfile
FROM python:3.12.9-slim-bookworm
```

**Step 2: Pin frontend Dockerfile images**

In `frontend/Dockerfile`, change:

```dockerfile
FROM node:22-slim AS build
```

To:

```dockerfile
FROM node:22.14-slim-bookworm AS build
```

The nginx image was already pinned to `nginxinc/nginx-unprivileged:1.27-alpine` in Task 7.

**Step 3: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile
git commit -m "fix: pin Docker base images to specific versions for reproducible builds"
```

---

## Tier 3 — PostHog Observability

### Task 9: Activate PostHog Project in gv-infra Terraform

This task is done in the `gv-infra` repo at `/Users/nickgerner/Code/gv-infra`.

**Files:**
- Modify: `/Users/nickgerner/Code/gv-infra/experiments/the-experiment/main.tf`
- Modify: `/Users/nickgerner/Code/gv-infra/experiments/the-experiment/posthog.tf`
- Modify: `/Users/nickgerner/Code/gv-infra/experiments/the-experiment/variables.tf`
- Modify: `/Users/nickgerner/Code/gv-infra/experiments/the-experiment/outputs.tf`
- Modify: `/Users/nickgerner/Code/gv-infra/experiments/the-experiment/terraform.tfvars`

**Step 1: Uncomment PostHog provider in main.tf**

In `main.tf`, uncomment the PostHog required provider block:

```hcl
    posthog = {
      source  = "posthog/posthog"
      version = "~> 1.0"
    }
```

And uncomment the provider block:

```hcl
provider "posthog" {
  api_key         = var.posthog_api_key
  organization_id = var.posthog_organization_id
  host            = "https://us.posthog.com"
}
```

**Step 2: Uncomment PostHog resource in posthog.tf**

```hcl
resource "posthog_project" "the_experiment" {
  name     = "the-experiment"
  timezone = "America/New_York"
}
```

**Step 3: Uncomment PostHog variables in variables.tf**

```hcl
variable "posthog_api_key" {
  description = "PostHog personal API key (for Terraform provider)"
  type        = string
  sensitive   = true
}

variable "posthog_organization_id" {
  description = "PostHog organization ID (UUID)"
  type        = string
}
```

**Step 4: Uncomment PostHog outputs in outputs.tf**

```hcl
output "posthog_project_id" {
  description = "PostHog project ID for the-experiment"
  value       = posthog_project.the_experiment.id
}

output "posthog_api_token" {
  description = "PostHog project API token (set as POSTHOG_KEY)"
  value       = posthog_project.the_experiment.api_token
  sensitive   = true
}
```

**Step 5: Add PostHog org ID to terraform.tfvars**

Add to `terraform.tfvars`:

```hcl
posthog_organization_id = "019a7e38-0676-0000-1a36-7f1b8e785f2f"
```

The `posthog_api_key` is injected via Doppler (not in tfvars).

**Step 6: Run Terraform**

```bash
cd /Users/nickgerner/Code/gv-infra/experiments/the-experiment
./scripts/tfrun.sh init -upgrade
./scripts/tfrun.sh plan
# Review output, then:
./scripts/tfrun.sh apply
```

**Step 7: Copy the PostHog API token to Doppler**

After `terraform apply`, copy the `posthog_api_token` output value and add it as `POSTHOG_KEY` in the Doppler `the-experiment/prd` config.

**Step 8: Commit (in gv-infra)**

```bash
cd /Users/nickgerner/Code/gv-infra
git add experiments/the-experiment/
git commit -m "feat: activate PostHog project for the-experiment"
```

---

### Task 10: Add PostHog Backend Integration

**Files:**
- Modify: `backend/pyproject.toml` (add `posthog` dependency)
- Create: `backend/app/core/posthog.py`
- Modify: `backend/app/core/config.py` (add `posthog_key` setting)
- Modify: `backend/app/main.py` (add startup event, exception handler)

**Step 1: Add posthog dependency**

Run: `cd backend && poetry add posthog`

**Step 2: Add `posthog_key` to Settings**

In `backend/app/core/config.py`, add to the `Settings` class after `cors_origins`:

```python
    posthog_key: str | None = None
    posthog_host: str = "https://us.posthog.com"
    posthog_enabled: bool = False
```

**Step 3: Create PostHog client module**

Create `backend/app/core/posthog.py`:

```python
from __future__ import annotations

import posthog as _posthog

from app.core.config import get_settings

_client: _posthog.Client | None = None

SYSTEM_ID = "backend-production"


def init() -> None:
    global _client
    settings = get_settings()
    if not settings.posthog_key or not settings.posthog_enabled:
        return
    _posthog.api_key = settings.posthog_key
    _posthog.host = settings.posthog_host
    _posthog.disabled = False
    _client = _posthog


def capture(event: str, properties: dict | None = None) -> None:
    if _client is None:
        return
    _client.capture(SYSTEM_ID, event, properties or {})


def shutdown() -> None:
    if _client is not None:
        _client.flush()
```

**Step 4: Wire PostHog into the app lifecycle**

In `backend/app/main.py`, update the imports and lifespan:

Add import:
```python
from app.core import posthog as ph
```

Update the lifespan context manager:

```python
@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ph.init()
    ph.capture("backend_started", {"version": settings.app_version})
    yield
    ph.shutdown()
```

**Step 5: Add exception capture middleware**

In `backend/app/main.py`, after the CORS middleware, add:

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
import traceback


class ExceptionCaptureMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            ph.capture("backend_exception", {
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "path": request.url.path,
                "method": request.method,
            })
            raise


app.add_middleware(ExceptionCaptureMiddleware)
```

**Step 6: Run tests**

Run: `cd backend && poetry run pytest -v`

Expected: All tests pass.

**Step 7: Commit**

```bash
git add backend/pyproject.toml backend/poetry.lock backend/app/core/posthog.py backend/app/core/config.py backend/app/main.py
git commit -m "feat: add PostHog backend integration for event capture and error tracking"
```

---

### Task 11: Add PostHog Frontend Integration

**Files:**
- Modify: `frontend/package.json` (add `posthog-js` dependency)
- Create: `frontend/src/plugins/posthog.ts`
- Modify: `frontend/src/main.ts` (initialize PostHog)

**Step 1: Install posthog-js**

Run: `cd frontend && npm install posthog-js --legacy-peer-deps`

**Step 2: Create PostHog plugin**

Create `frontend/src/plugins/posthog.ts`:

```typescript
import posthog from 'posthog-js'
import type { App } from 'vue'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string) || 'https://us.posthog.com'

export function initPostHog(app: App): void {
  if (!POSTHOG_KEY) return

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      recordCrossOriginIframes: false,
    },
  })

  // Global error tracking
  window.addEventListener('error', (event) => {
    posthog.capture('$exception', {
      $exception_message: event.message,
      $exception_source: event.filename,
      $exception_lineno: event.lineno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    posthog.capture('$exception', {
      $exception_message: String(event.reason),
      $exception_type: 'unhandled_promise_rejection',
    })
  })

  app.config.globalProperties.$posthog = posthog
}

export { posthog }
```

**Step 3: Initialize in main.ts**

In `frontend/src/main.ts`, add the import and call:

```typescript
import { initPostHog } from './plugins/posthog'
```

And after `app.mount('#app')` (or before, after `createApp`), add:

```typescript
initPostHog(app)
```

The exact placement depends on the current `main.ts` structure — add the import at the top with other imports, and call `initPostHog(app)` after the app is created but before or after mount.

**Step 4: Add env var to production build**

The `VITE_POSTHOG_KEY` environment variable needs to be available at frontend build time. In `.github/workflows/deploy.yml`, the frontend build step should pass it:

In the "Build and push Docker images" step, change the frontend build line from:

```bash
docker build -t "${REGISTRY}/the-experiment-frontend:${TAG}" -t "${REGISTRY}/the-experiment-frontend:latest" ./frontend
```

To:

```bash
docker build --build-arg VITE_POSTHOG_KEY="${POSTHOG_KEY}" -t "${REGISTRY}/the-experiment-frontend:${TAG}" -t "${REGISTRY}/the-experiment-frontend:latest" ./frontend
```

And in `frontend/Dockerfile`, add the build arg before the build step. After the `COPY . .` line in the build stage, add:

```dockerfile
ARG VITE_POSTHOG_KEY=""
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
```

**Step 5: Build check**

Run: `cd frontend && npm run build && npm run type-check`

Expected: Build succeeds, no type errors.

**Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/plugins/posthog.ts frontend/src/main.ts frontend/Dockerfile .github/workflows/deploy.yml
git commit -m "feat: add PostHog frontend integration with error tracking and session recording"
```

---

### Task 12: Final Verification

**Step 1: Run all backend tests**

Run: `cd backend && poetry run pytest -v`

Expected: All pass.

**Step 2: Run all frontend tests and build**

Run: `cd frontend && npm run type-check && npm run build && npm test`

Expected: All pass.

**Step 3: Lint all Helm chart variants**

Run: `helm lint chart/the-experiment/ && helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml && helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml`

Expected: All 3 pass with 0 failures.

**Step 4: Template render check**

Run: `helm template test chart/the-experiment/ -f chart/the-experiment/values-production.yaml > /dev/null`

Expected: No errors.

**Step 5: Commit any remaining changes and verify clean working tree**

Run: `git status`

Expected: Clean working tree (all changes committed).
