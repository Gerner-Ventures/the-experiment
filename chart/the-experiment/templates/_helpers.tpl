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
Selector labels
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
