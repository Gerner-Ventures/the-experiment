# Workstream 3: Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace standalone K8s manifests with a Helm chart, Terraform module, CI/CD pipelines, and Alembic migrations that integrate into the gv-infra Digital Ocean ecosystem.

**Architecture:** Two-container deployment (backend + frontend) with in-cluster Redis, deployed to the shared DOKS cluster via Helm. Infrastructure provisioned in gv-infra Terraform. Secrets flow from Doppler through GitHub Actions. Neon for production Postgres.

**Tech Stack:** Helm 3, Terraform, GitHub Actions, Docker multi-stage, Alembic, structlog, nginx, Doppler, DOCR, DOKS

---

### Task 1: Remove raw K8s manifests

The `k8s/` directory contains raw manifests that are being replaced by the Helm chart.

**Files:**
- Delete: `k8s/` (entire directory)

**Step 1: Delete the k8s directory**

```bash
rm -rf k8s/
```

**Step 2: Commit**

```bash
git add -A k8s/
git commit -m "chore: remove raw K8s manifests (replaced by Helm chart)"
```

---

### Task 2: Create Helm chart skeleton

**Files:**
- Create: `chart/the-experiment/Chart.yaml`
- Create: `chart/the-experiment/values.yaml`
- Create: `chart/the-experiment/values-production.yaml`
- Create: `chart/the-experiment/templates/_helpers.tpl`
- Create: `chart/the-experiment/templates/NOTES.txt`

**Step 1: Create Chart.yaml**

```yaml
# chart/the-experiment/Chart.yaml
apiVersion: v2
name: the-experiment
description: "AI agent simulation engine — Lord of the Flies meets The Truman Show"
type: application
version: 0.1.0
appVersion: "0.1.0"
maintainers:
  - name: Gerner Ventures
keywords:
  - ai
  - simulation
  - agents
  - game
```

**Step 2: Create values.yaml**

This defines all chart defaults. Key differences from Canon: two container images (backend/frontend), Redis sidecar, no CronJobs, no GitHub App / GCP / MCP / Jira secrets.

```yaml
# chart/the-experiment/values.yaml

## @section Global parameters
replicaCount: 1

## @section Backend image parameters
backend:
  image:
    registry: ""
    repository: the-experiment-backend
    tag: ""
    pullPolicy: IfNotPresent
  resources:
    limits:
      memory: 512Mi
    requests:
      cpu: 200m
      memory: 256Mi

## @section Frontend image parameters
frontend:
  image:
    registry: ""
    repository: the-experiment-frontend
    tag: ""
    pullPolicy: IfNotPresent
  resources:
    limits:
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi

## @section Redis parameters
redis:
  enabled: true
  image: redis:7-alpine
  resources:
    limits:
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi

## @param imagePullSecrets Docker registry pull secret names
imagePullSecrets: []

## @param nameOverride Override chart name
nameOverride: ""
## @param fullnameOverride Override full resource name
fullnameOverride: ""

## @section Service account
serviceAccount:
  create: true
  name: ""
  annotations: {}

## @section Secrets
secrets:
  ## @section Neon DB secrets
  neon:
    databaseUrl: ""
    existingSecret: ""

  ## @section Auth0 secrets
  auth0:
    domain: ""
    clientId: ""
    clientSecret: ""
    audience: ""
    existingSecret: ""

  ## @section LiteLLM secrets (LLM API keys)
  litellm:
    anthropicApiKey: ""
    openaiApiKey: ""
    existingSecret: ""

  ## @section PostHog secrets
  posthog:
    apiKey: ""
    existingSecret: ""

## @section Application configuration
config:
  backendPort: 8000
  logLevel: "info"
  redisUrl: ""  # auto-set to redis://redis:6379 in helpers if empty
  posthogEnabled: "false"
  platformUrl: ""

## @section Service parameters
service:
  type: ClusterIP
  backendPort: 8000
  frontendPort: 80

## @section Ingress parameters
ingress:
  enabled: false
  className: "nginx"
  annotations: {}
  hostname: ""
  tls: false
  tlsSecret: ""

## @section Pod parameters
podAnnotations: {}

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  fsGroup: 1001

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL

## @section Autoscaling
autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 3
  targetCPUUtilizationPercentage: 80
```

**Step 3: Create values-production.yaml**

```yaml
# chart/the-experiment/values-production.yaml
## Production overrides for DigitalOcean K8s deployment

backend:
  image:
    registry: registry.digitalocean.com
    repository: gv-shared/the-experiment-backend
    tag: "" # Set by CI: --set backend.image.tag=sha-<short>

frontend:
  image:
    registry: registry.digitalocean.com
    repository: gv-shared/the-experiment-frontend
    tag: "" # Set by CI: --set frontend.image.tag=sha-<short>

imagePullSecrets:
  - name: registry-gv-shared

ingress:
  enabled: true
  className: nginx
  hostname: the-experiment.gernerventures.com
  tls: true
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-production

secrets:
  neon:
    existingSecret: the-experiment-neon
  auth0:
    existingSecret: the-experiment-auth0
  litellm:
    existingSecret: the-experiment-litellm
  posthog:
    existingSecret: the-experiment-posthog

config:
  posthogEnabled: "true"
  platformUrl: "https://the-experiment.gernerventures.com"

backend:
  resources:
    limits:
      memory: 512Mi
    requests:
      cpu: 200m
      memory: 256Mi
```

**Step 4: Create _helpers.tpl**

```
{{/*
chart/the-experiment/templates/_helpers.tpl
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "the-experiment.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "the-experiment.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "the-experiment.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "the-experiment.labels" -}}
helm.sh/chart: {{ include "the-experiment.chart" . }}
{{ include "the-experiment.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Backend selector labels
*/}}
{{- define "the-experiment.selectorLabels" -}}
app.kubernetes.io/name: {{ include "the-experiment.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "the-experiment.backendSelectorLabels" -}}
{{ include "the-experiment.selectorLabels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{- define "the-experiment.frontendSelectorLabels" -}}
{{ include "the-experiment.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{- define "the-experiment.redisSelectorLabels" -}}
{{ include "the-experiment.selectorLabels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
Service account name
*/}}
{{- define "the-experiment.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "the-experiment.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Backend container image
*/}}
{{- define "the-experiment.backendImage" -}}
{{- $tag := default .Chart.AppVersion .Values.backend.image.tag -}}
{{- if .Values.backend.image.registry -}}
{{ .Values.backend.image.registry }}/{{ .Values.backend.image.repository }}:{{ $tag }}
{{- else -}}
{{ .Values.backend.image.repository }}:{{ $tag }}
{{- end -}}
{{- end }}

{{/*
Frontend container image
*/}}
{{- define "the-experiment.frontendImage" -}}
{{- $tag := default .Chart.AppVersion .Values.frontend.image.tag -}}
{{- if .Values.frontend.image.registry -}}
{{ .Values.frontend.image.registry }}/{{ .Values.frontend.image.repository }}:{{ $tag }}
{{- else -}}
{{ .Values.frontend.image.repository }}:{{ $tag }}
{{- end -}}
{{- end }}

{{/*
Redis URL — auto-generates if not explicitly set
*/}}
{{- define "the-experiment.redisUrl" -}}
{{- if .Values.config.redisUrl -}}
{{ .Values.config.redisUrl }}
{{- else -}}
redis://{{ include "the-experiment.fullname" . }}-redis:6379
{{- end -}}
{{- end }}

{{/*
Secret name helpers
*/}}
{{- define "the-experiment.neonSecretName" -}}
{{- if .Values.secrets.neon.existingSecret -}}
{{ .Values.secrets.neon.existingSecret }}
{{- else -}}
{{ include "the-experiment.fullname" . }}-neon
{{- end -}}
{{- end }}

{{- define "the-experiment.auth0SecretName" -}}
{{- if .Values.secrets.auth0.existingSecret -}}
{{ .Values.secrets.auth0.existingSecret }}
{{- else -}}
{{ include "the-experiment.fullname" . }}-auth0
{{- end -}}
{{- end }}

{{- define "the-experiment.litellmSecretName" -}}
{{- if .Values.secrets.litellm.existingSecret -}}
{{ .Values.secrets.litellm.existingSecret }}
{{- else -}}
{{ include "the-experiment.fullname" . }}-litellm
{{- end -}}
{{- end }}

{{- define "the-experiment.posthogSecretName" -}}
{{- if .Values.secrets.posthog.existingSecret -}}
{{ .Values.secrets.posthog.existingSecret }}
{{- else -}}
{{ include "the-experiment.fullname" . }}-posthog
{{- end -}}
{{- end }}
```

**Step 5: Create NOTES.txt**

```
{{/* chart/the-experiment/templates/NOTES.txt */}}
{{- if .Values.ingress.enabled }}
The Experiment is available at:
  https://{{ .Values.ingress.hostname }}

Verify with:
  kubectl get ingress -n {{ .Release.Namespace }}
  kubectl get pods -n {{ .Release.Namespace }}
{{- else }}
Access via port-forward:
  kubectl port-forward svc/{{ include "the-experiment.fullname" . }}-frontend 8080:{{ .Values.service.frontendPort }} -n {{ .Release.Namespace }}
  Open http://localhost:8080
{{- end }}
```

**Step 6: Commit**

```bash
git add chart/
git commit -m "feat: add Helm chart skeleton with values and helpers"
```

---

### Task 3: Create Helm templates — ConfigMap, Secrets, ServiceAccount

**Files:**
- Create: `chart/the-experiment/templates/configmap.yaml`
- Create: `chart/the-experiment/templates/secret.yaml`
- Create: `chart/the-experiment/templates/serviceaccount.yaml`

**Step 1: Create configmap.yaml**

```yaml
# chart/the-experiment/templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "the-experiment.fullname" . }}
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
data:
  PORT: {{ .Values.config.backendPort | quote }}
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
  REDIS_URL: {{ include "the-experiment.redisUrl" . | quote }}
  POSTHOG_ENABLED: {{ .Values.config.posthogEnabled | quote }}
  {{- if .Values.config.platformUrl }}
  PLATFORM_URL: {{ .Values.config.platformUrl | quote }}
  {{- end }}
```

**Step 2: Create secret.yaml**

```yaml
# chart/the-experiment/templates/secret.yaml

{{- if and .Values.secrets.neon.databaseUrl (not .Values.secrets.neon.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "the-experiment.fullname" . }}-neon
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
type: Opaque
stringData:
  DATABASE_URL: {{ .Values.secrets.neon.databaseUrl | quote }}
---
{{- end }}

{{- if and .Values.secrets.auth0.domain (not .Values.secrets.auth0.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "the-experiment.fullname" . }}-auth0
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
type: Opaque
stringData:
  AUTH0_DOMAIN: {{ .Values.secrets.auth0.domain | quote }}
  AUTH0_CLIENT_ID: {{ .Values.secrets.auth0.clientId | quote }}
  AUTH0_CLIENT_SECRET: {{ .Values.secrets.auth0.clientSecret | quote }}
  AUTH0_AUDIENCE: {{ .Values.secrets.auth0.audience | quote }}
---
{{- end }}

{{- if and .Values.secrets.litellm.anthropicApiKey (not .Values.secrets.litellm.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "the-experiment.fullname" . }}-litellm
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
type: Opaque
stringData:
  ANTHROPIC_API_KEY: {{ .Values.secrets.litellm.anthropicApiKey | quote }}
  {{- if .Values.secrets.litellm.openaiApiKey }}
  OPENAI_API_KEY: {{ .Values.secrets.litellm.openaiApiKey | quote }}
  {{- end }}
---
{{- end }}

{{- if and .Values.secrets.posthog.apiKey (not .Values.secrets.posthog.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "the-experiment.fullname" . }}-posthog
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
type: Opaque
stringData:
  POSTHOG_KEY: {{ .Values.secrets.posthog.apiKey | quote }}
{{- end }}
```

**Step 3: Create serviceaccount.yaml**

```yaml
# chart/the-experiment/templates/serviceaccount.yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "the-experiment.serviceAccountName" . }}
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

**Step 4: Commit**

```bash
git add chart/the-experiment/templates/
git commit -m "feat: add Helm templates for ConfigMap, Secrets, ServiceAccount"
```

---

### Task 4: Create Helm templates — Backend Deployment + Service

**Files:**
- Create: `chart/the-experiment/templates/backend-deployment.yaml`
- Create: `chart/the-experiment/templates/backend-service.yaml`

**Step 1: Create backend-deployment.yaml**

```yaml
# chart/the-experiment/templates/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "the-experiment.fullname" . }}-backend
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: backend
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "the-experiment.backendSelectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "the-experiment.backendSelectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "the-experiment.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: backend
          image: {{ include "the-experiment.backendImage" . }}
          imagePullPolicy: {{ .Values.backend.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: {{ .Values.config.backendPort }}
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ include "the-experiment.fullname" . }}
          {{- if or .Values.secrets.neon.databaseUrl .Values.secrets.neon.existingSecret }}
            - secretRef:
                name: {{ include "the-experiment.neonSecretName" . }}
          {{- end }}
          {{- if or .Values.secrets.auth0.domain .Values.secrets.auth0.existingSecret }}
            - secretRef:
                name: {{ include "the-experiment.auth0SecretName" . }}
          {{- end }}
          {{- if or .Values.secrets.litellm.anthropicApiKey .Values.secrets.litellm.existingSecret }}
            - secretRef:
                name: {{ include "the-experiment.litellmSecretName" . }}
          {{- end }}
          {{- if or .Values.secrets.posthog.apiKey .Values.secrets.posthog.existingSecret }}
            - secretRef:
                name: {{ include "the-experiment.posthogSecretName" . }}
          {{- end }}
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 3
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            {{- toYaml .Values.backend.resources | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

**Step 2: Create backend-service.yaml**

```yaml
# chart/the-experiment/templates/backend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "the-experiment.fullname" . }}-backend
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: backend
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.backendPort }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "the-experiment.backendSelectorLabels" . | nindent 4 }}
```

**Step 3: Commit**

```bash
git add chart/the-experiment/templates/backend-*
git commit -m "feat: add Helm templates for backend Deployment and Service"
```

---

### Task 5: Create Helm templates — Frontend Deployment + Service

**Files:**
- Create: `chart/the-experiment/templates/frontend-deployment.yaml`
- Create: `chart/the-experiment/templates/frontend-service.yaml`

**Step 1: Create frontend-deployment.yaml**

```yaml
# chart/the-experiment/templates/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "the-experiment.fullname" . }}-frontend
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: frontend
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "the-experiment.frontendSelectorLabels" . | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "the-experiment.frontendSelectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: frontend
          image: {{ include "the-experiment.frontendImage" . }}
          imagePullPolicy: {{ .Values.frontend.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 3
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 2
            periodSeconds: 10
          resources:
            {{- toYaml .Values.frontend.resources | nindent 12 }}
```

Note: Frontend runs nginx as root (standard nginx:alpine behavior), so no podSecurityContext override. The backend is the security-sensitive container.

**Step 2: Create frontend-service.yaml**

```yaml
# chart/the-experiment/templates/frontend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "the-experiment.fullname" . }}-frontend
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: frontend
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.frontendPort }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "the-experiment.frontendSelectorLabels" . | nindent 4 }}
```

**Step 3: Commit**

```bash
git add chart/the-experiment/templates/frontend-*
git commit -m "feat: add Helm templates for frontend Deployment and Service"
```

---

### Task 6: Create Helm templates — Redis Deployment + Service

**Files:**
- Create: `chart/the-experiment/templates/redis-deployment.yaml`
- Create: `chart/the-experiment/templates/redis-service.yaml`

**Step 1: Create redis-deployment.yaml**

```yaml
# chart/the-experiment/templates/redis-deployment.yaml
{{- if .Values.redis.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "the-experiment.fullname" . }}-redis
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "the-experiment.redisSelectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "the-experiment.redisSelectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: redis
          image: {{ .Values.redis.image }}
          ports:
            - name: redis
              containerPort: 6379
              protocol: TCP
          livenessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 3
            periodSeconds: 5
          resources:
            {{- toYaml .Values.redis.resources | nindent 12 }}
{{- end }}
```

**Step 2: Create redis-service.yaml**

```yaml
# chart/the-experiment/templates/redis-service.yaml
{{- if .Values.redis.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "the-experiment.fullname" . }}-redis
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
    app.kubernetes.io/component: redis
spec:
  type: ClusterIP
  ports:
    - port: 6379
      targetPort: redis
      protocol: TCP
      name: redis
  selector:
    {{- include "the-experiment.redisSelectorLabels" . | nindent 4 }}
{{- end }}
```

**Step 3: Commit**

```bash
git add chart/the-experiment/templates/redis-*
git commit -m "feat: add Helm templates for in-cluster Redis"
```

---

### Task 7: Create Helm templates — Ingress + HPA

**Files:**
- Create: `chart/the-experiment/templates/ingress.yaml`
- Create: `chart/the-experiment/templates/hpa.yaml`

**Step 1: Create ingress.yaml**

This ingress routes `/api` and `/ws` to the backend, and everything else to the frontend.

```yaml
# chart/the-experiment/templates/ingress.yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "the-experiment.fullname" . }}
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
  annotations:
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls }}
  tls:
    - hosts:
        - {{ .Values.ingress.hostname }}
      secretName: {{ .Values.ingress.tlsSecret | default (printf "%s-tls" (include "the-experiment.fullname" .)) }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.hostname }}
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: {{ include "the-experiment.fullname" . }}-backend
                port:
                  name: http
          - path: /ws
            pathType: Prefix
            backend:
              service:
                name: {{ include "the-experiment.fullname" . }}-backend
                port:
                  name: http
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "the-experiment.fullname" . }}-frontend
                port:
                  name: http
{{- end }}
```

**Step 2: Create hpa.yaml**

```yaml
# chart/the-experiment/templates/hpa.yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "the-experiment.fullname" . }}-backend
  labels:
    {{- include "the-experiment.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "the-experiment.fullname" . }}-backend
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
```

**Step 3: Verify Helm chart lints**

Run: `helm lint chart/the-experiment/`
Expected: "1 chart(s) linted, 0 chart(s) failed"

Run: `helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml`
Expected: "1 chart(s) linted, 0 chart(s) failed"

**Step 4: Commit**

```bash
git add chart/the-experiment/templates/ingress.yaml chart/the-experiment/templates/hpa.yaml
git commit -m "feat: add Helm templates for Ingress and HPA"
```

---

### Task 8: Production Dockerfiles

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `frontend/Dockerfile`
- Modify: `frontend/nginx.conf`

**Step 1: Rewrite backend/Dockerfile**

Multi-stage build following Canon pattern: install deps in build stage, copy to slim runtime.

```dockerfile
# backend/Dockerfile
# ── Stage 1: Install dependencies ──────────────────────
FROM python:3.12-slim AS build

WORKDIR /app

RUN pip install poetry && poetry config virtualenvs.in-project true

COPY pyproject.toml poetry.lock* ./
RUN poetry install --no-dev --no-interaction --no-ansi

COPY . .

# ── Stage 2: Production runtime ────────────────────────
FROM python:3.12-slim

RUN groupadd -r app -g 1001 && \
    useradd -r -g app -u 1001 -d /app app

WORKDIR /app

COPY --from=build /app/.venv /app/.venv
COPY --from=build /app .

ENV PATH="/app/.venv/bin:$PATH"

USER 1001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
```

**Step 2: Rewrite frontend/Dockerfile**

Multi-stage: build Vue app, serve with nginx.

```dockerfile
# frontend/Dockerfile
# ── Stage 1: Build Vue app ─────────────────────────────
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Serve with nginx ──────────────────────────
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

**Step 3: Update frontend/nginx.conf for production**

In production, nginx serves static files and the ingress controller handles routing to backend. The `/api` and `/ws` proxy_pass blocks are only needed for local docker-compose (where there's no ingress). Keep them for local dev compatibility, but the production ingress will route before they're hit.

The existing `frontend/nginx.conf` is already correct for this — no changes needed. It proxies `/api/` and `/ws/` to `backend:8000` which works in docker-compose, and in production the ingress routes those paths before they reach nginx.

**Step 4: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile
git commit -m "feat: production multi-stage Dockerfiles for DOCR"
```

---

### Task 9: Update Makefile

**Files:**
- Modify: `Makefile`

**Step 1: Add Helm and Docker targets**

Add these targets to the existing Makefile:

```makefile
# After the existing 'clean' target, add:

# Helm
helm-lint:
	helm lint chart/the-experiment/
	helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml

# Docker build (local)
docker-build:
	docker build -t the-experiment-backend:local ./backend
	docker build -t the-experiment-frontend:local ./frontend
```

Also update the `.PHONY` line at top to include the new targets:

```makefile
.PHONY: dev stop build test lint migrate seed clean helm-lint docker-build
```

**Step 2: Commit**

```bash
git add Makefile
git commit -m "feat: add helm-lint and docker-build Makefile targets"
```

---

### Task 10: CI workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create ci.yml**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Poetry
        run: pip install poetry

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: "poetry"
          cache-dependency-path: backend/poetry.lock

      - name: Install backend deps
        run: cd backend && poetry install

      - name: Lint
        run: cd backend && poetry run ruff check .

      - name: Format check
        run: cd backend && poetry run ruff format --check .

      - name: Type check
        run: cd backend && poetry run mypy app

      - name: Test
        run: cd backend && poetry run pytest

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend deps
        run: cd frontend && npm ci

      - name: Lint frontend
        run: cd frontend && npm run lint

      - name: Type check frontend
        run: cd frontend && npm run type-check

      - name: Build frontend
        run: cd frontend && npm run build

  helm-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Lint with defaults
        run: helm lint chart/the-experiment/

      - name: Lint with production values
        run: helm lint chart/the-experiment/ -f chart/the-experiment/values-production.yaml
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add CI workflow (lint, test, helm lint)"
```

---

### Task 11: Deploy workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Create deploy.yml**

Follows the Canon deploy.yml pattern exactly.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Poetry
        run: pip install poetry

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: "poetry"
          cache-dependency-path: backend/poetry.lock

      - name: Install backend deps
        run: cd backend && poetry install

      - name: Lint
        run: cd backend && poetry run ruff check .

      - name: Format check
        run: cd backend && poetry run ruff format --check .

      - name: Test
        run: cd backend && poetry run pytest

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend deps
        run: cd frontend && npm ci

      - name: Build frontend
        run: cd frontend && npm run build

  deploy:
    needs: check
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Fetch secrets from Doppler
        uses: dopplerhq/secrets-fetch-action@v1.3.1
        id: secrets
        with:
          doppler-token: ${{ secrets.DOPPLER_SERVICE_TOKEN }}
          doppler-project: the-experiment
          doppler-config: prd

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ steps.secrets.outputs.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Log in to DOCR
        run: doctl registry login --expiry-seconds 600

      - name: Build and push Docker images
        run: |
          REGISTRY="registry.digitalocean.com/${{ steps.secrets.outputs.DOCR_REGISTRY_NAME }}"
          TAG="sha-${GITHUB_SHA::7}"

          docker build -t "${REGISTRY}/the-experiment-backend:${TAG}" -t "${REGISTRY}/the-experiment-backend:latest" ./backend
          docker push "${REGISTRY}/the-experiment-backend:${TAG}"
          docker push "${REGISTRY}/the-experiment-backend:latest"

          docker build -t "${REGISTRY}/the-experiment-frontend:${TAG}" -t "${REGISTRY}/the-experiment-frontend:latest" ./frontend
          docker push "${REGISTRY}/the-experiment-frontend:${TAG}"
          docker push "${REGISTRY}/the-experiment-frontend:latest"

          echo "IMAGE_TAG=${TAG}" >> "$GITHUB_ENV"

      - name: Save kubeconfig
        run: doctl kubernetes cluster kubeconfig save ${{ steps.secrets.outputs.DOKS_CLUSTER_NAME }}

      - name: Ensure DOCR pull secret
        run: |
          kubectl create namespace the-experiment --dry-run=client -o yaml | kubectl apply -f -
          doctl registry kubernetes-manifest --namespace the-experiment | kubectl apply -f -

      - name: Ensure app secrets
        env:
          DATABASE_URL: ${{ steps.secrets.outputs.DATABASE_URL }}
          AUTH0_DOMAIN: ${{ steps.secrets.outputs.AUTH0_DOMAIN }}
          AUTH0_CLIENT_ID: ${{ steps.secrets.outputs.AUTH0_CLIENT_ID }}
          AUTH0_CLIENT_SECRET: ${{ steps.secrets.outputs.AUTH0_CLIENT_SECRET }}
          AUTH0_AUDIENCE: ${{ steps.secrets.outputs.AUTH0_AUDIENCE }}
          ANTHROPIC_API_KEY: ${{ steps.secrets.outputs.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ steps.secrets.outputs.OPENAI_API_KEY }}
          POSTHOG_KEY: ${{ steps.secrets.outputs.POSTHOG_KEY }}
        run: |
          kubectl create secret generic the-experiment-neon \
            --from-literal=DATABASE_URL="$DATABASE_URL" \
            -n the-experiment --dry-run=client -o yaml | kubectl apply -f -
          kubectl create secret generic the-experiment-auth0 \
            --from-literal=AUTH0_DOMAIN="$AUTH0_DOMAIN" \
            --from-literal=AUTH0_CLIENT_ID="$AUTH0_CLIENT_ID" \
            --from-literal=AUTH0_CLIENT_SECRET="$AUTH0_CLIENT_SECRET" \
            --from-literal=AUTH0_AUDIENCE="$AUTH0_AUDIENCE" \
            -n the-experiment --dry-run=client -o yaml | kubectl apply -f -
          kubectl create secret generic the-experiment-litellm \
            --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
            --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
            -n the-experiment --dry-run=client -o yaml | kubectl apply -f -
          kubectl create secret generic the-experiment-posthog \
            --from-literal=POSTHOG_KEY="$POSTHOG_KEY" \
            -n the-experiment --dry-run=client -o yaml | kubectl apply -f -

      - name: Deploy with Helm
        run: |
          helm upgrade --install the-experiment chart/the-experiment/ \
            -f chart/the-experiment/values-production.yaml \
            --set backend.image.tag="${IMAGE_TAG}" \
            --set frontend.image.tag="${IMAGE_TAG}" \
            -n the-experiment --create-namespace \
            --wait --timeout 5m
```

**Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add deploy workflow (Doppler -> DOCR -> Helm)"
```

---

### Task 12: Alembic initialization

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/.gitkeep`
- Create: `backend/alembic/script.py.mako`

**Step 1: Initialize Alembic**

Run from `backend/`:

```bash
cd backend && poetry run alembic init alembic
```

This creates `alembic.ini` and `alembic/` directory with boilerplate.

**Step 2: Update alembic.ini**

Set the `sqlalchemy.url` to empty — we'll read from env in `env.py`:

In `backend/alembic.ini`, set:
```ini
sqlalchemy.url =
```

**Step 3: Update alembic/env.py**

Replace the generated `env.py` with one that reads `DATABASE_URL` from environment:

```python
# backend/alembic/env.py
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Read DATABASE_URL from environment, fall back to local docker-compose default
database_url = os.environ.get(
    "DATABASE_URL",
    "postgresql://experiment:experiment@localhost:5432/experiment",
)
config.set_main_option("sqlalchemy.url", database_url)

# Import models here once they exist (S2.1)
# from app.db.models import Base
# target_metadata = Base.metadata
target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(config.get_main_option("sqlalchemy.url"))
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Step 4: Verify Alembic works against local Postgres**

```bash
docker compose up -d postgres
cd backend && poetry run alembic heads
```

Expected: Shows current head (empty if no migrations yet)

**Step 5: Commit**

```bash
git add backend/alembic.ini backend/alembic/
git commit -m "feat: initialize Alembic for database migrations"
```

---

### Task 13: Add structlog to backend

**Files:**
- Modify: `backend/pyproject.toml` (add structlog dependency)
- Create: `backend/app/logging.py`
- Modify: `backend/app/main.py` (configure logging on startup)

**Step 1: Add structlog dependency**

In `backend/pyproject.toml`, add to `[tool.poetry.dependencies]`:

```toml
structlog = "^24.0"
```

Then install:
```bash
cd backend && poetry add structlog
```

**Step 2: Create backend/app/logging.py**

```python
# backend/app/logging.py
import logging
import os

import structlog


def setup_logging() -> None:
    log_level = os.environ.get("LOG_LEVEL", "info").upper()

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(format="%(message)s", level=getattr(logging, log_level))
```

**Step 3: Update backend/app/main.py**

Add logging setup to app startup:

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.logging import setup_logging

setup_logging()

app = FastAPI(
    title="the-experiment",
    description="AI agent simulation engine",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

**Step 4: Verify it works**

```bash
cd backend && poetry install && poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
curl http://localhost:8000/health
# Expected: {"status":"ok"}
kill %1
```

**Step 5: Commit**

```bash
git add backend/pyproject.toml backend/poetry.lock backend/app/logging.py backend/app/main.py
git commit -m "feat: add structlog for structured JSON logging"
```

---

### Task 14: gv-infra Terraform module

This task is executed in the **gv-infra** repo, not the-experiment.

**Files (in /Users/nickgerner/Code/gv-infra/):**
- Create: `experiments/the-experiment/main.tf`
- Create: `experiments/the-experiment/variables.tf`
- Create: `experiments/the-experiment/dns.tf`
- Create: `experiments/the-experiment/auth0.tf`
- Create: `experiments/the-experiment/posthog.tf`
- Create: `experiments/the-experiment/outputs.tf`

**Step 1: Create main.tf**

```hcl
# experiments/the-experiment/main.tf
terraform {
  required_version = ">= 1.0"

  backend "s3" {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    bucket = "gv-terraform-state"
    key    = "experiments/the-experiment/terraform.tfstate"
    region = "us-east-1"

    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    posthog = {
      source  = "posthog/posthog"
      version = "~> 1.0"
    }
  }
}

provider "auth0" {
  domain        = var.auth0_domain
  client_id     = var.auth0_tf_client_id
  client_secret = var.auth0_tf_client_secret
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile != "" ? var.aws_profile : null
}

provider "posthog" {
  api_key         = var.posthog_api_key
  organization_id = var.posthog_organization_id
  host            = "https://us.posthog.com"
}

data "terraform_remote_state" "core" {
  backend = "s3"

  config = {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    bucket                      = "gv-terraform-state"
    key                         = "core/terraform.tfstate"
    region                      = "us-east-1"
    access_key                  = var.do_spaces_access_key
    secret_key                  = var.do_spaces_secret_key
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
```

**Step 2: Create variables.tf**

```hcl
# experiments/the-experiment/variables.tf

# Auth0 — Terraform M2M credentials
variable "auth0_domain" {
  description = "Auth0 tenant domain (e.g. gv-os.us.auth0.com)"
  type        = string
}

variable "auth0_tf_client_id" {
  description = "Auth0 M2M application client ID (for Terraform)"
  type        = string
  sensitive   = true
}

variable "auth0_tf_client_secret" {
  description = "Auth0 M2M application client secret (for Terraform)"
  type        = string
  sensitive   = true
}

# DO Spaces — for reading core state via terraform_remote_state
variable "do_spaces_access_key" {
  description = "DigitalOcean Spaces access key (for reading core state)"
  type        = string
  sensitive   = true
}

variable "do_spaces_secret_key" {
  description = "DigitalOcean Spaces secret key (for reading core state)"
  type        = string
  sensitive   = true
}

# AWS — Route 53 DNS
variable "aws_region" {
  description = "AWS region (Route 53 is global, API lives in us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use for authentication (leave empty for CI/OIDC)"
  type        = string
  default     = ""
}

# PostHog
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

**Step 3: Create dns.tf**

```hcl
# experiments/the-experiment/dns.tf
# A record: the-experiment.gernerventures.com -> DOKS ingress LB

resource "aws_route53_record" "the_experiment" {
  zone_id = data.terraform_remote_state.core.outputs.route53_zone_id
  name    = "the-experiment.gernerventures.com"
  type    = "A"
  ttl     = 300
  records = [data.terraform_remote_state.core.outputs.ingress_lb_ip]
}
```

**Step 4: Create auth0.tf**

```hcl
# experiments/the-experiment/auth0.tf
# Minimal Auth0 setup — single web app client, no roles/scopes/M2M

resource "auth0_client" "the_experiment" {
  name        = "The Experiment"
  description = "AI agent simulation game"
  app_type    = "regular_web"

  callbacks = [
    "https://the-experiment.gernerventures.com/auth/callback",
    "http://localhost:5173/auth/callback",
    "http://localhost:8000/auth/callback",
  ]

  allowed_logout_urls = [
    "https://the-experiment.gernerventures.com",
    "http://localhost:5173",
    "http://localhost:8000",
  ]

  web_origins = [
    "https://the-experiment.gernerventures.com",
    "http://localhost:5173",
    "http://localhost:8000",
  ]

  oidc_conformant = true

  jwt_configuration {
    alg = "RS256"
  }
}

resource "auth0_client_credentials" "the_experiment" {
  client_id             = auth0_client.the_experiment.id
  authentication_method = "client_secret_post"
}
```

**Step 5: Create posthog.tf**

```hcl
# experiments/the-experiment/posthog.tf
resource "posthog_project" "the_experiment" {
  name     = "the-experiment"
  timezone = "America/New_York"
}
```

**Step 6: Create outputs.tf**

```hcl
# experiments/the-experiment/outputs.tf

# Auth0 outputs — store in Doppler the-experiment/prd after terraform apply
output "auth0_client_id" {
  description = "Auth0 client ID (set as AUTH0_CLIENT_ID)"
  value       = auth0_client.the_experiment.client_id
}

output "auth0_client_secret" {
  description = "Auth0 client secret (set as AUTH0_CLIENT_SECRET)"
  value       = auth0_client_credentials.the_experiment.client_secret
  sensitive   = true
}

output "auth0_domain" {
  description = "Auth0 tenant domain (set as AUTH0_DOMAIN)"
  value       = var.auth0_domain
}

# PostHog outputs
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

**Step 7: Commit (in gv-infra repo)**

```bash
cd /Users/nickgerner/Code/gv-infra
git add experiments/the-experiment/
git commit -m "feat: add the-experiment Terraform module (DNS, Auth0, PostHog)"
```

**Step 8: Post-apply manual steps (documented, not automated)**

After running `terraform apply`:

1. Copy Auth0 client ID from outputs, add to `core/terraform.tfvars` `experiment_auth0_client_ids` list, re-apply core
2. Create Doppler project `the-experiment` with config `prd`
3. Store outputs in Doppler: `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_DOMAIN`, `POSTHOG_KEY`
4. Also add to Doppler: `DIGITALOCEAN_ACCESS_TOKEN`, `DOCR_REGISTRY_NAME` (`gv-shared`), `DOKS_CLUSTER_NAME` (`gv-shared`), `DATABASE_URL` (from Neon), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
5. Create GitHub repo secret `DOPPLER_SERVICE_TOKEN` for the-experiment repo

---

### Task 15: Create Neon database

This is a manual step using `neonctl`.

**Step 1: Create the database**

```bash
neonctl projects create --name the-experiment
```

Note the connection string from output.

**Step 2: Store in Doppler**

Add `DATABASE_URL` to Doppler `the-experiment/prd` config with the Neon connection string.

**Step 3: Verify local Alembic works against Neon**

```bash
cd /Users/nickgerner/Code/the-experiment/backend
DATABASE_URL="<neon-connection-string>" poetry run alembic heads
```

Expected: Shows current head (empty if no migrations yet)

---

### Task 16: Verify end-to-end locally

**Step 1: Verify docker-compose still works**

```bash
cd /Users/nickgerner/Code/the-experiment
docker compose up --build
```

Expected: Backend on :8000, frontend on :5173, Postgres on :5432, Redis on :6379 all healthy.

```bash
curl http://localhost:8000/health
# Expected: {"status":"ok"}
```

**Step 2: Verify Helm chart lints**

```bash
make helm-lint
```

Expected: Both lint passes succeed.

**Step 3: Verify Docker builds**

```bash
make docker-build
```

Expected: Both images build successfully.

**Step 4: Commit any fixes if needed**

```bash
git add -A && git commit -m "fix: address integration issues from end-to-end verification"
```

---

## Summary of all deliverables

| Task | Repo | What |
|------|------|------|
| 1 | the-experiment | Remove `k8s/` directory |
| 2 | the-experiment | Helm chart skeleton (Chart.yaml, values, helpers) |
| 3 | the-experiment | Helm templates: ConfigMap, Secret, ServiceAccount |
| 4 | the-experiment | Helm templates: Backend Deployment + Service |
| 5 | the-experiment | Helm templates: Frontend Deployment + Service |
| 6 | the-experiment | Helm templates: Redis Deployment + Service |
| 7 | the-experiment | Helm templates: Ingress + HPA |
| 8 | the-experiment | Production Dockerfiles |
| 9 | the-experiment | Makefile updates |
| 10 | the-experiment | CI workflow (GitHub Actions) |
| 11 | the-experiment | Deploy workflow (GitHub Actions) |
| 12 | the-experiment | Alembic initialization |
| 13 | the-experiment | structlog setup |
| 14 | gv-infra | Terraform module (DNS, Auth0, PostHog) |
| 15 | manual | Create Neon database + Doppler config |
| 16 | the-experiment | End-to-end verification |
