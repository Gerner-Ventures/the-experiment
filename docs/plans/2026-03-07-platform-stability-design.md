# Platform Stability Hardening — Design

**Date:** 2026-03-07
**Status:** Approved
**Scope:** Production Kubernetes infrastructure for the-experiment on `gv-shared` DOKS cluster

## Context

After deploying to production, the backend entered `Init:CrashLoopBackOff` due to a non-idempotent Alembic migration. Investigation revealed 23 stability issues across 8 categories. The cluster is a single-node `s-2vcpu-4gb` (2 vCPU / 4 GiB) shared across experiments, which constrains what's practical.

## Constraints

- Single-node cluster — HPA, PDB, anti-affinity not useful
- PostHog for all observability (no Prometheus/Grafana)
- Harden production only — no staging environment for now
- gv-infra manages shared infra (DOKS, ingress-nginx, cert-manager, DOCR)

## Design

### Tier 1 — Stop the Bleeding

#### 1.1 Fix Alembic Migration Bug

**Problem:** Migration `20260306_000001` explicitly creates enums with `checkfirst=True`, then `op.create_table()` triggers SQLAlchemy's `_on_table_create` which tries to create them again with `checkfirst=False`. Migrations cannot run on a fresh database.

**Fix:** Remove the explicit `.create(bind, checkfirst=True)` calls for all 4 enums. Instead, pass `create_constraint=False` is not needed — just define the enums inline in the column definitions using string-based `sa.Enum(...)` with `create_type=True` (default). SQLAlchemy's `create_table` will handle creation. The explicit `.create()` calls are redundant and cause the conflict.

Alternatively (simpler, lower risk): keep the explicit `.create()` calls but set `create_type=False` on each `sa.Enum()` instance so `create_table` doesn't try to auto-create them. This is the safer fix since it only adds a parameter rather than restructuring the migration.

**Chosen approach:** Add `create_type=False` to each `sa.Enum()` constructor in migration `000001`. The explicit `.create(bind, checkfirst=True)` remains the sole creator. Same pattern for `downgrade()` — the explicit `.drop()` calls handle cleanup.

#### 1.2 Add `--atomic` to Helm Deploy

**Problem:** `deploy.yml` runs `helm upgrade --install ... --wait --timeout 5m` without `--atomic`. A failed deploy (e.g., migration crash) leaves the release in `FAILED` state requiring manual `helm rollback`.

**Fix:** Add `--atomic` flag. On failure, Helm automatically rolls back to the previous release.

**File:** `.github/workflows/deploy.yml`

#### 1.3 Add `revisionHistoryLimit`

**Problem:** No limit set; Kubernetes defaults to 10. We have 13+ stale ReplicaSets.

**Fix:** Add `revisionHistoryLimit: 3` to both backend and frontend Deployment specs in the Helm templates.

**Files:** `chart/the-experiment/templates/backend-deployment.yaml`, `frontend-deployment.yaml`

#### 1.4 Rate Limiting on `/api` Ingress

**Problem:** No rate limiting. Any client can trigger unlimited LLM API calls.

**Fix:** Add nginx ingress annotations to the `/api` path:
```yaml
nginx.ingress.kubernetes.io/limit-rps: "10"
nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
nginx.ingress.kubernetes.io/limit-connections: "5"
```

10 RPS with burst of 30 is generous for a game simulation UI but prevents abuse. These apply per-client-IP.

**File:** `chart/the-experiment/templates/ingress.yaml` (add annotations), `values.yaml` / `values-production.yaml` (make configurable)

#### 1.5 SSL Redirect + HSTS

**Problem:** HTTP requests not redirected to HTTPS. No HSTS header.

**Fix:** Add ingress annotations:
```yaml
nginx.ingress.kubernetes.io/ssl-redirect: "true"
nginx.ingress.kubernetes.io/hsts: "true"
nginx.ingress.kubernetes.io/hsts-max-age: "31536000"
nginx.ingress.kubernetes.io/hsts-include-subdomains: "true"
```

**File:** `chart/the-experiment/templates/ingress.yaml` or `values-production.yaml`

#### 1.6 Deeper Health Probes

**Problem:** `/api/health` returns `{"status":"ok"}` without checking DB or Redis. Backend can be "ready" with a dead database.

**Fix:** Add dependency checks to the health endpoint:
- Readiness probe: check DB connection pool + Redis ping. If either is down, pod is marked not-ready and stops receiving traffic.
- Liveness probe: keep shallow (just process alive) — we don't want to restart the pod if Neon has a brief hiccup.

Split into two endpoints:
- `GET /api/health` — shallow liveness (existing)
- `GET /api/health/ready` — deep readiness (new: checks DB + Redis)

Update the backend Deployment readiness probe to hit `/api/health/ready`.

**Files:** `backend/app/api/routes/health.py` (or wherever the health endpoint lives), `chart/the-experiment/templates/backend-deployment.yaml`

### Tier 2 — Production Hardening

#### 2.1 RollingUpdate Strategy

**Problem:** `Recreate` strategy kills all pods before starting new ones — guaranteed downtime on every deploy.

**Fix:** Change to `RollingUpdate` with `maxUnavailable: 0` and `maxSurge: 1`. The new pod starts (including running migrations in the init container) before the old pod is terminated.

**Prerequisite:** Migrations must be backward-compatible (additive only — new columns, new tables). The existing migrations are all additive, so this is safe. Document this as a convention going forward.

**Files:** `chart/the-experiment/templates/backend-deployment.yaml`, `frontend-deployment.yaml`

#### 2.2 CPU Limits

**Problem:** No CPU limits on any workload. A runaway process can starve the single 2-vCPU node.

**Fix:** Add CPU limits:
- Backend: 500m (half a vCPU)
- Frontend: 100m
- Redis: 100m
- Postgres (local only): 250m

**File:** `chart/the-experiment/values.yaml`, `values-production.yaml`

#### 2.3 WebSocket Drain (`preStop` Hook)

**Problem:** On deploy, pods are killed immediately. Active WebSocket connections are hard-disconnected.

**Fix:** Add a `preStop` lifecycle hook with a sleep to allow the load balancer to drain connections:
```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "10"]
```

Combined with `terminationGracePeriodSeconds: 45` to allow in-flight LLM calls to complete.

**File:** `chart/the-experiment/templates/backend-deployment.yaml`

#### 2.4 Security Contexts for Frontend/Redis/Postgres

**Problem:** Frontend nginx, Redis, and Postgres all run as root with no security hardening.

**Fix:**
- Frontend: use `nginxinc/nginx-unprivileged` base image or add `runAsUser: 101` (nginx user). Add `readOnlyRootFilesystem: true` with tmpfs for `/tmp`, `/var/cache/nginx`, `/var/run`.
- Redis: add `runAsUser: 999` (redis user), `readOnlyRootFilesystem: true` with tmpfs for `/data`.
- Postgres: already runs as `postgres` (UID 70 on Alpine). Add explicit `runAsUser: 70`.
- All: add `seccompProfile: { type: RuntimeDefault }`, `allowPrivilegeEscalation: false`, `capabilities: { drop: [ALL] }`.

**Files:** `chart/the-experiment/templates/redis-deployment.yaml`, `postgres-statefulset.yaml`, `frontend-deployment.yaml`, `frontend/Dockerfile`

#### 2.5 Pin Docker Base Images

**Problem:** `python:3.12-slim`, `nginx:alpine` float with upstream releases. Builds are non-reproducible.

**Fix:** Pin to specific version tags (not digests — too noisy for maintenance):
- `python:3.12.9-slim-bookworm`
- `nginx:1.27-alpine`
- `node:22-slim` → `node:22.14-slim-bookworm`

**Files:** `backend/Dockerfile`, `frontend/Dockerfile`

### Tier 3 — PostHog Observability

#### 3.1 Activate PostHog Project in Terraform

**Problem:** PostHog project resource is commented out in `experiments/the-experiment/posthog.tf`.

**Fix:** Uncomment the PostHog provider, project resource, variables, and outputs. Run `terraform apply`.

**Files:** `gv-infra/experiments/the-experiment/main.tf`, `posthog.tf`, `variables.tf`, `outputs.tf`, `terraform.tfvars`

#### 3.2 Backend PostHog Integration

Instrument the FastAPI backend with `posthog-python` to capture:
- **Deploy events:** migration success/failure, app startup
- **LLM metrics:** model, latency, token count, cost estimate per call
- **Error events:** unhandled exceptions with stack traces
- **Health metrics:** periodic DB/Redis connection status (optional — may be noisy)

Use PostHog's `capture()` for events and `set()` for properties on a system-level "distinct_id" (e.g., `backend-production`).

**Files:** New middleware or event hooks in the backend app

#### 3.3 Frontend Error Tracking

Integrate `posthog-js` (likely already present given `POSTHOG_ENABLED`). Ensure:
- `posthog.captureException()` is wired to `window.onerror` and `unhandledrejection`
- Session recording enabled for debugging
- Key user actions captured (start experiment, observe round, etc.)

**Files:** Frontend PostHog initialization code

#### 3.4 PostHog Dashboard

Create a PostHog dashboard with:
- Deploy frequency and success rate
- LLM call volume, latency p50/p95, cost
- Error rate over time
- Active experiments / WebSocket connections

This is configured in PostHog UI, not in code.
