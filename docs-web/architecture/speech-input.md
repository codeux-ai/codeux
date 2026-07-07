# Speech Input Architecture

Speech input turns dashboard audio uploads into prompt text through `POST /api/speech/transcriptions`. The endpoint accepts one multipart `audio` file plus optional metadata such as `projectId`, `sprintId`, `requestId`, `language`, `durationSeconds`, `maxAudioSeconds`, and `source`.

## Settings Boundary

Speech settings are project-scoped. They flow through defaults, override resolution, validation, and sanitization alongside other project settings. The `speech` object stores whether transcription is enabled, the provider mode, local ONNX model id, maximum audio duration, and external transcription fallback configuration.

The default provider mode is `auto`, which is intended to prefer local ONNX transcription first and fall back to an OpenAI-compatible external API only when local transcription is unavailable.

## Privacy Boundary

Microphone audio must not enter runtime memory automatically. Capture flows must require an explicit user gesture and permission grant. Settings may store provider configuration, model ids, endpoint URL, and optional language, but defaults and examples must not include real API keys.

Audio bytes remain request-scoped in the upload route and transcription service. They are not written to settings, project artifacts, logs, telemetry, or memory records.

## Upload Guardrails

The transcription endpoint is handled by route-specific `multer` middleware, not the dashboard JSON parser. It stores the uploaded file in memory, accepts only supported audio MIME types, applies a 25MB upload limit, and rejects requests that exceed supplied route-level `maxAudioSeconds` metadata. The backend service also enforces the resolved speech setting's `maxAudioSeconds` before invoking a provider.

## Provider Fallback Behavior

The contracts separate settings mode from execution provider:

- `local_onnx` is local model inference.
- `external_api` is an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

Structured transcription errors cover unsupported audio, missing local models, permission/client errors, and provider failures.

Local model files are resolved under deterministic cache directories in `~/.code-ux/models/speech/<model-id>`. In `auto` mode, Code UX uses local ONNX first when the selected model is present. If the model is missing and an external base URL, API key, and model are configured, the service falls back to an OpenAI-style multipart request using bearer token auth and returns fallback metadata. Provider error messages are sanitized before returning to the dashboard so API keys are never echoed.
