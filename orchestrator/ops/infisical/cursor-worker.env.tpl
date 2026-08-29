{{- /* Production secrets for cursor-worker + board-watch on VPS.
     Project: win-predict-ai (id below; slug is win-predict-ai-s-vm-f).
     Env slug "prod" = Production. */ -}}
{{- with listSecrets "dfa13c01-4d8c-48e3-b725-b56b1a36f338" "prod" "/" `{"recursive": false, "expandSecretReferences": true}` }}
{{- range . }}
{{ .Key }}={{ .Value }}
{{- end }}
{{- end }}
