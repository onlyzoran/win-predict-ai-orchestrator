{{- /* Production secrets for cursor-worker + board-watch on VPS.
     Project slug must match Infisical Project Settings → Slug.
     Env slug "prod" = Production. */ -}}
{{- with listSecretsByProjectSlug "win-predict-ai" "prod" "/" `{"recursive": false, "expandSecretReferences": true}` }}
{{- range . }}
{{ .Key }}={{ .Value }}
{{- end }}
{{- end }}
