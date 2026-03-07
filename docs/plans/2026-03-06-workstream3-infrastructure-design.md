# Workstream 3: Infrastructure Design (gv-infra Aligned)

## Context

Workstream 3 provides the infrastructure foundation for the-experiment, an AI simulation game. The initial skeleton (S3.1) scaffolded the monorepo with raw K8s manifests and Docker Compose. This design replaces the standalone infrastructure with patterns that integrate into the gv-infra Terraform ecosystem and Digital Ocean infrastructure (DOKS, DOCR, Doppler, Neon).

**Reference implementation:** Canon (gv-exp-specwright) — the proven pattern for DOKS-hosted apps in this ecosystem.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain | `the-experiment.gernerventures.com` | GV subdomain — simpler, no new hosted zone needed |
| DOKS sizing | Keep current 1x s-2vcpu-4gb | Cheapest, revisit when needed |
| Auth0 scope | Minimal — single web app client | Just protect the UI, no roles/scopes/M2M |
| Database | Neon (managed Postgres) | Existing pattern, provisioned via neonctl, credentials in Doppler |
| Redis | In-cluster deployment | Free, ephemeral cache + pub/sub, data loss is acceptable |
| Monitoring | Structured logs + PostHog + LLM cost table | No Prometheus/Datadog — overkill for single-node hobby project |

## Section 1: Repository Structure Changes

**Remove:** `k8s/` directory (raw manifests replaced by Helm chart)

**Add:**

```
chart/the-experiment/
├── Chart.yaml
├── values.yaml                # defaults (local/dev)
├── values-production.yaml     # DOKS overrides
├── templates/
│   ├── _helpers.tpl
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── frontend-deployment.yaml
│   ├── frontend-service.yaml
│   ├── redis-deployment.yaml
│   ├── redis-service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── serviceaccount.yaml
│   └── NOTES.txt
.github/workflows/
├── ci.yml                     # PR: lint, test, helm lint
├── deploy.yml                 # main push: doppler -> docker -> DOCR -> helm upgrade
```

**Modify:**

- `backend/Dockerfile` — Multi-stage production build (Poetry install -> slim runtime)
- `backend/Dockerfile.dev` — Dev build with hot-reload
- `frontend/Dockerfile` — Multi-stage (npm ci -> build -> nginx)
- `frontend/Dockerfile.dev` — Vite dev server
- `docker-compose.yml` — Keep as-is for local dev
- `Makefile` — Add `make helm-lint`, `make docker-build`

## Section 2: Helm Chart Design

### Backend Deployment

- Image: `registry.digitalocean.com/gv-shared/the-experiment-backend`
- Port 8000, non-root user (1001), read-only root filesystem
- `envFrom`: ConfigMap + secrets (neon, auth0, litellm, posthog)
- Liveness/readiness: `/health`
- Resources: 200m CPU / 256Mi request, 512Mi memory limit
- Checksum annotations on ConfigMap + Secrets for auto-restart on change

### Frontend Deployment

- Image: `registry.digitalocean.com/gv-shared/the-experiment-frontend`
- Port 80 (nginx serving built Vue app)
- Minimal env — backend API URL only
- Resources: 50m CPU / 64Mi request, 128Mi limit

### Redis Deployment

- Image: `redis:7-alpine`
- Port 6379, no persistence (ephemeral cache + pub/sub)
- Resources: 50m CPU / 64Mi request, 128Mi limit
- ClusterIP service, backend connects via `redis://redis:6379`

### Ingress

- `className: nginx`, cert-manager annotation for Let's Encrypt TLS
- Host: `the-experiment.gernerventures.com`
- Path routing: `/api` -> backend, `/ws` -> backend, `/` -> frontend

### Secrets (existingSecret pattern)

- `the-experiment-neon` — DATABASE_URL
- `the-experiment-auth0` — AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE
- `the-experiment-litellm` — ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
- `the-experiment-posthog` — POSTHOG_KEY

### ConfigMap

- PORT, LOG_LEVEL, REDIS_URL, PLATFORM_URL, POSTHOG_ENABLED

### values-production.yaml

DOCR image refs, `imagePullSecrets: registry-gv-shared`, ingress hostname, TLS, `existingSecret` references. HPA template exists but disabled initially.

## Section 3: gv-infra Terraform Module

**New directory:** `gv-infra/experiments/the-experiment/`

### main.tf

- Backend: DO Spaces (`key: experiments/the-experiment/terraform.tfstate`)
- Providers: Auth0, AWS, PostHog (no GCP)
- `terraform_remote_state.core` for ingress LB IP

### dns.tf

- A record: `the-experiment.gernerventures.com` -> core ingress LB IP
- Uses existing `gernerventures.com` Route 53 zone from core (`data.terraform_remote_state.core.outputs.route53_zone_id`)

### auth0.tf (minimal)

- `auth0_client.the_experiment` — Regular web app
  - Callbacks: production + localhost
  - Logout URLs: production + localhost
  - Web origins: production + localhost
- `auth0_client_credentials.the_experiment` — Managed secret
- Add client ID to `core/terraform.tfvars` -> `experiment_auth0_client_ids`
- No resource server, roles, scopes, M2M, CLI, or post-login action

### posthog.tf

- `posthog_project.the_experiment` — timezone: America/New_York

### variables.tf

- Auth0: domain, tf client ID/secret
- DO Spaces: access key, secret key
- AWS: region (us-east-1)
- PostHog: api key, organization ID

### outputs.tf

- `auth0_client_id`, `auth0_client_secret` (sensitive)
- `posthog_project_id`, `posthog_api_token` (sensitive)
- Stored in Doppler `the-experiment/prd` after first apply

## Section 4: CI/CD Pipelines

### ci.yml (on PR)

**Job 1: check** — Backend lint/format/test (uv + ruff + pytest), frontend lint/type-check/build (npm)

**Job 2: helm-lint** (parallel) — Lint with default + production values

### deploy.yml (on push to main)

1. **check** — Same gate as ci.yml
2. **deploy** (needs: check, environment: production)
   - Fetch secrets from Doppler (`the-experiment/prd`)
   - `doctl` login + DOCR auth
   - Build + push two images:
     - `gv-shared/the-experiment-backend:sha-<short>`
     - `gv-shared/the-experiment-frontend:sha-<short>`
   - Save DOKS kubeconfig
   - Create namespace + DOCR pull secret + K8s secrets from Doppler
   - `helm upgrade --install` with image tags

### Doppler project: `the-experiment/prd`

Secrets: DIGITALOCEAN_ACCESS_TOKEN, DOCR_REGISTRY_NAME, DOKS_CLUSTER_NAME, DATABASE_URL, AUTH0_*, ANTHROPIC_API_KEY, OPENAI_API_KEY, POSTHOG_KEY

GitHub repo secret: `DOPPLER_SERVICE_TOKEN`

## Section 5: Database & Migrations

### Neon Database

- Create via `neonctl`, store connection string in Doppler as `DATABASE_URL`
- No Terraform management (existing pattern)

### Alembic Setup

- Initialize in `backend/`: `alembic.ini` + `backend/alembic/` with `env.py` and `versions/`
- `env.py` reads `DATABASE_URL` from environment
- Initial migration empty (tables from S2.1)

### Seed Data

- `backend/scripts/seed.py` — default town map + preset arcs
- `make seed` target, deferred until S2.1/S2.2

### Local Dev

- Keep PostgreSQL in docker-compose.yml for local dev
- Alembic runs against local Postgres in dev, Neon in production

### Migration Runner

- Alembic `upgrade head` as init container or pre-deploy step in Helm chart

## Section 6: Monitoring & Observability

### Structured Logging

- `structlog` in backend, JSON to stdout
- Fields: experiment_id, round_number, agent_id, phase, event_type
- Viewable in DO dashboard via default cluster logging

### PostHog

- Frontend: JS SDK for session tracking
- Backend: Python SDK for experiment events

### LLM Cost Tracking

- App-level (S2.7), but schema defined in Alembic
- Table: `llm_usage` (experiment_id, agent_id, round, provider, model, tokens, cost)
- API: `GET /experiments/{id}/costs`

### Health Probes

- Backend `/health` checks DB + Redis
- Helm liveness + readiness probes
