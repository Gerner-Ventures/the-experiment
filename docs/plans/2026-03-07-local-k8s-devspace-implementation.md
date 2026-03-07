# Local K8s Postgres + DevSpace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add local Postgres to the Helm chart (toggle), configure DevSpace for local k8s development with hot reload, and verify the full stack on the `codex/pr33-runtime-persistence` branch.

**Architecture:** Extend the existing Helm chart with a postgres StatefulSet/Service gated on `postgres.enabled`. Add DevSpace config that wraps `helm upgrade` with `values-local.yaml` overrides. Add Makefile targets for the new workflow.

**Tech Stack:** Helm 3, DevSpace 6, Postgres 16, Docker Desktop Kubernetes

---

### Task 0: Merge main into PR branch

**Files:**
- No file changes — git operations only

**Step 1: Checkout the PR branch and merge main**

```bash
git checkout codex/pr33-runtime-persistence
git merge main
```

If there are merge conflicts, resolve them (most likely in `frontend/package-lock.json` or `Makefile`).

**Step 2: Verify the merge**

```bash
git log --oneline -5
```

Expected: merge commit on top, branch has both PR commits and latest main commits.

**Step 3: Push the merged branch**

```bash
git push origin codex/pr33-runtime-persistence
```

---

### Task 1: Add Postgres StatefulSet template

**Files:**
- Create: `chart/the-experiment/templates/postgres-statefulset.yaml`

**Step 1: Create the StatefulSet template**

```yaml
{{- if .Values.postgres.enabled }}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "the-experiment.fullname" . }}-postgres
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
spec:
  serviceName: {{ include "the-experiment.fullname" . }}-postgres
  replicas: 1
  selector:
    matchLabels:
      {{- include "the-experiment.postgresSelectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "the-experiment.postgresSelectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: postgres
          image: {{ .Values.postgres.image }}
          ports:
            - name: postgres
              containerPort: 5432
              protocol: TCP
          env:
            - name: POSTGRES_DB
              value: {{ .Values.postgres.database | quote }}
            - name: POSTGRES_USER
              value: {{ .Values.postgres.user | quote }}
            - name: POSTGRES_PASSWORD
              value: {{ .Values.postgres.password | quote }}
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", {{ .Values.postgres.user | quote }}]
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", {{ .Values.postgres.user | quote }}]
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            {{- toYaml .Values.postgres.resources | nindent 12 }}
          volumeMounts:
            - name: pgdata
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: pgdata
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: {{ .Values.postgres.storage }}
{{- end }}
```

**Step 2: Verify template renders**

Run: `helm template test chart/the-experiment/ --set postgres.enabled=true | grep -A 5 "kind: StatefulSet"`
Expected: StatefulSet manifest appears in output.

---

### Task 2: Add Postgres Service template

**Files:**
- Create: `chart/the-experiment/templates/postgres-service.yaml`

**Step 1: Create the Service template**

```yaml
{{- if .Values.postgres.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "the-experiment.fullname" . }}-postgres
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: postgres
      protocol: TCP
      name: postgres
  selector:
    {{- include "the-experiment.postgresSelectorLabels" . | nindent 4 }}
{{- end }}
```

---

### Task 3: Update _helpers.tpl with Postgres helpers

**Files:**
- Modify: `chart/the-experiment/templates/_helpers.tpl` (append after line 145)

**Step 1: Add postgres selector labels and URL helper**

Append to `_helpers.tpl`:

```yaml
{{- define "the-experiment.postgresSelectorLabels" -}}
{{ include "the-experiment.selectorLabels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Postgres URL — auto-generates when local postgres is enabled
*/}}
{{- define "the-experiment.postgresUrl" -}}
postgresql+asyncpg://{{ .Values.postgres.user }}:{{ .Values.postgres.password }}@{{ include "the-experiment.fullname" . }}-postgres:5432/{{ .Values.postgres.database }}
{{- end }}
```

---

### Task 4: Update values.yaml with Postgres defaults

**Files:**
- Modify: `chart/the-experiment/values.yaml` (add after redis section, ~line 42)

**Step 1: Add postgres values block**

Insert after the redis section:

```yaml
## @section Postgres parameters (local development only)
postgres:
  enabled: false
  image: postgres:16-alpine
  storage: 1Gi
  database: experiment
  user: experiment
  password: experiment
  resources:
    limits:
      memory: 256Mi
    requests:
      cpu: 100m
      memory: 128Mi
```

**Step 2: Verify defaults don't break existing templates**

Run: `helm template test chart/the-experiment/`
Expected: No postgres resources in output (disabled by default).

Run: `helm template test chart/the-experiment/ --set postgres.enabled=true`
Expected: postgres StatefulSet and Service appear.

---

### Task 5: Wire DATABASE_URL for local Postgres

**Files:**
- Modify: `chart/the-experiment/templates/backend-deployment.yaml` (add init container + conditional DATABASE_URL env var)
- Modify: `chart/the-experiment/templates/configmap.yaml` (add conditional DATABASE_URL)

**Step 1: Add DATABASE_URL to configmap when postgres.enabled**

In `configmap.yaml`, add after line 14 (before the closing of data):

```yaml
  {{- if .Values.postgres.enabled }}
  DATABASE_URL: {{ include "the-experiment.postgresUrl" . | quote }}
  {{- end }}
```

**Step 2: Add Alembic migration init container to backend deployment**

In `backend-deployment.yaml`, add an `initContainers` block before the `containers` block (after line 34, before line 35):

```yaml
      {{- if .Values.postgres.enabled }}
      initContainers:
        - name: migrate
          image: {{ include "the-experiment.backendImage" . }}
          imagePullPolicy: {{ .Values.backend.image.pullPolicy }}
          command: ["alembic", "upgrade", "head"]
          envFrom:
            - configMapRef:
                name: {{ include "the-experiment.fullname" . }}
          {{- if or .Values.secrets.neon.databaseUrl .Values.secrets.neon.existingSecret }}
            - secretRef:
                name: {{ include "the-experiment.neonSecretName" . }}
          {{- end }}
          env:
            - name: DATABASE_URL
              value: {{ include "the-experiment.postgresUrl" . | replace "+asyncpg" "+psycopg" | quote }}
      {{- end }}
```

Note: The init container overrides DATABASE_URL with the `+psycopg` driver variant since Alembic runs synchronous migrations.

**Step 3: Verify template renders correctly**

Run: `helm template test chart/the-experiment/ --set postgres.enabled=true | grep -A 20 "initContainers"`
Expected: migrate init container with psycopg URL.

Run: `helm template test chart/the-experiment/ | grep initContainers`
Expected: No output (init container not present when postgres disabled).

---

### Task 6: Create values-local.yaml

**Files:**
- Create: `chart/the-experiment/values-local.yaml`

**Step 1: Create the local dev values overlay**

```yaml
## Local development overrides (Docker Desktop Kubernetes)

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
    databaseUrl: ""

## Relax security for local dev (writable fs for hot reload volumes)
podSecurityContext:
  runAsNonRoot: false
  runAsUser: 0
  runAsGroup: 0
  fsGroup: 0

securityContext:
  readOnlyRootFilesystem: false
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

**Step 2: Verify local values render**

Run: `helm template test chart/the-experiment/ -f chart/the-experiment/values-local.yaml`
Expected: Postgres StatefulSet/Service present, backend image is `the-experiment-backend:dev`, no Neon secret.

**Step 3: Verify production values still render**

Run: `helm template test chart/the-experiment/ -f chart/the-experiment/values-production.yaml`
Expected: No Postgres resources, uses existing secrets.

**Step 4: Lint all value combinations**

Run: `helm lint chart/the-experiment/`
Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml`
Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`
Expected: All pass.

**Step 5: Commit Helm chart changes**

```bash
git add chart/
git commit -m "feat: add local Postgres toggle to Helm chart

Add postgres StatefulSet/Service gated on postgres.enabled (default false).
Add values-local.yaml for Docker Desktop k8s development.
Add Alembic migration init container when local postgres enabled."
```

---

### Task 7: Create DevSpace configuration

**Files:**
- Create: `devspace.yaml`

**Step 1: Create devspace.yaml**

```yaml
version: v2beta1
name: the-experiment

vars:
  NAMESPACE: the-experiment
  HELM_VALUES: chart/the-experiment/values-local.yaml

pipelines:
  dev:
    run: |-
      run_dependencies --all
      ensure_pull_secrets --all
      build_images --all
      create_deployments --all
      start_dev --all
  deploy:
    run: |-
      run_dependencies --all
      ensure_pull_secrets --all
      build_images --all
      create_deployments --all
  purge:
    run: |-
      stop_dev --all
      purge_deployments --all

images:
  backend:
    image: the-experiment-backend
    dockerfile: ./backend/Dockerfile
    context: ./backend
    tags:
      - dev
    skipPush: true
  frontend:
    image: the-experiment-frontend
    dockerfile: ./frontend/Dockerfile
    context: ./frontend
    tags:
      - dev
    skipPush: true

deployments:
  the-experiment:
    namespace: ${NAMESPACE}
    helm:
      chart:
        name: ./chart/the-experiment
      values:
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
        podSecurityContext:
          runAsNonRoot: false
          runAsUser: 0
          runAsGroup: 0
          fsGroup: 0
        securityContext:
          readOnlyRootFilesystem: false
          allowPrivilegeEscalation: false
          capabilities:
            drop:
              - ALL
      valuesFiles:
        - ${HELM_VALUES}

dev:
  backend:
    imageSelector: the-experiment-backend
    namespace: ${NAMESPACE}
    sync:
      - path: ./backend:/app
        excludePaths:
          - .venv/
          - __pycache__/
          - .mypy_cache/
          - .ruff_cache/
          - "*.pyc"
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    ports:
      - port: "8000:8000"
    env:
      - name: DATABASE_URL
        value: "postgresql+asyncpg://experiment:experiment@the-experiment-postgres:5432/experiment"
  frontend:
    imageSelector: the-experiment-frontend
    namespace: ${NAMESPACE}
    ports:
      - port: "5173:80"
  postgres:
    imageSelector: postgres:16-alpine
    namespace: ${NAMESPACE}
    ports:
      - port: "5432:5432"
  redis:
    imageSelector: redis:7-alpine
    namespace: ${NAMESPACE}
    ports:
      - port: "6379:6379"

hooks:
  - name: migrate-db
    events: ["after:deploy:the-experiment"]
    command: |-
      kubectl exec -n ${NAMESPACE} deploy/the-experiment-backend -- alembic upgrade head
    wait:
      running: true
```

**Step 2: Create .devspace/ gitignore entry**

Ensure `.gitignore` has `.devspace/` (DevSpace cache directory).

**Step 3: Commit**

```bash
git add devspace.yaml .gitignore
git commit -m "feat: add DevSpace config for local k8s development

Wraps existing Helm chart with dev overrides. Builds images locally
(skipPush), syncs backend code for hot reload, forwards ports for
backend (8000), frontend (5173), postgres (5432), redis (6379).
Post-deploy hook runs Alembic migrations."
```

---

### Task 8: Add Makefile targets for local k8s

**Files:**
- Modify: `Makefile` (add after Helm section, ~line 198)

**Step 1: Add local k8s targets**

Insert before the Cleanup section:

```makefile
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
```

**Step 2: Add helm-lint for local values**

In the existing `helm-lint` target (~line 197), add the local values lint:

```makefile
helm-lint: ## Lint Helm charts (default + production + local values)
	helm lint chart/the-experiment/
	helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml
	helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml
```

**Step 3: Commit**

```bash
git add Makefile
git commit -m "feat: add Makefile targets for local k8s dev with DevSpace"
```

---

### Task 9: Verify the full stack locally

**Step 1: Ensure Docker Desktop Kubernetes is enabled**

```bash
kubectl cluster-info
kubectl get nodes
```

Expected: Shows Docker Desktop cluster info and a `docker-desktop` node.

**Step 2: Create namespace**

```bash
kubectl create namespace the-experiment --dry-run=client -o yaml | kubectl apply -f -
```

**Step 3: Run helm lint on all value files**

```bash
make helm-lint
```

Expected: All 3 lint passes succeed.

**Step 4: Build and deploy with DevSpace**

```bash
make local-up
```

Expected: DevSpace builds both images, deploys Helm chart, postgres + redis + backend + frontend pods come up.

**Step 5: Check pod status**

```bash
make local-status
```

Expected: All pods Running (postgres, redis, backend, frontend). Backend init container should have completed (migration).

**Step 6: Verify backend health**

```bash
kubectl exec -n the-experiment deploy/the-experiment-backend -- python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

Expected: Health check response.

**Step 7: Verify database connectivity**

```bash
make local-db-shell
```

Then in psql:
```sql
\dt
```

Expected: Tables from Alembic migrations are present (experiments, agents, rounds, events, etc.).

**Step 8: Verify port forwarding**

```bash
curl -s http://localhost:8000/health
```

Expected: Backend health response.

**Step 9: Tear down**

```bash
make local-down
```

Expected: All resources purged.

**Step 10: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: adjust local k8s config for Docker Desktop compatibility"
```

**Step 11: Push**

```bash
git push origin codex/pr33-runtime-persistence
```

---

### Task 10: Update PR description

**Step 1: Update the PR body to reflect new additions**

```bash
gh pr edit 34 --body "$(cat <<'EOF'
## Summary
- add a store abstraction so the runtime can persist simulation state through SQLAlchemy while keeping websocket connections in-memory
- extend the schema for runtime-only fields such as world state, recent events, unresolved plotlines, agent goal payloads, and GM plan status metadata
- record event logs and round snapshots in Postgres, and keep API tests running against the in-memory store for fast verification
- add `greenlet` as an explicit backend dependency for the async SQLAlchemy runtime path
- add reviewer-facing infrastructure docs with Mermaid diagrams covering topology, runtime boundaries, and persistence flow
- **NEW:** add local Postgres StatefulSet/Service to Helm chart (gated on `postgres.enabled`)
- **NEW:** add DevSpace configuration for local k8s development with hot reload
- **NEW:** add `values-local.yaml` for Docker Desktop Kubernetes
- **NEW:** add Makefile targets: `local-up`, `local-dev`, `local-down`, `local-status`, `local-logs`, `local-db-shell`

## Local K8s Development

```bash
# Deploy to local k8s
make local-up

# Dev mode with file sync + port forwarding
make local-dev

# Check status
make local-status

# Tear down
make local-down
```

Ports: backend (8000), frontend (5173), postgres (5432), redis (6379)

## Docs
- `docs/INFRASTRUCTURE.md`
- `docs/plans/2026-03-07-local-k8s-devspace-design.md`

## Testing
- `poetry run pytest tests/test_api_layer.py`
- `helm lint chart/the-experiment/ -f chart/the-experiment/values-local.yaml`
- `make local-up && make local-status` (verify all pods running)
- `make local-db-shell` → `\dt` (verify migrations ran)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
