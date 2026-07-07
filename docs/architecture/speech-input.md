# Speech Input Architecture

Speech input turns dashboard audio uploads into prompt text through a backend transcription endpoint. The first runtime surface is `POST /api/speech/transcriptions`, a multipart endpoint that accepts one `audio` file plus optional metadata such as `projectId`, `sprintId`, `requestId`, `language`, `durationSeconds`, `maxAudioSeconds`, and `source`.

## Settings Boundary

Speech settings are project-scoped and flow through the same settings defaults, override resolution, validation, and sanitization path as memory settings. The persisted `speech` object controls whether transcription is enabled, which provider mode is preferred, the local ONNX model id, a bounded maximum audio duration, and an external transcription fallback endpoint.

The default provider mode is `auto`. In auto mode, runtime implementation should prefer the local ONNX transcription provider first and use the external API provider only as an explicit fallback when local transcription is unavailable or cannot satisfy the request.

## Privacy Boundary

Actual microphone audio must not enter runtime memory automatically. A recorder UI or Electron shell integration must require an explicit user gesture and permission grant before capturing audio. Persisted settings store only configuration values such as provider mode, model ids, endpoint URL, and optional language; defaults and fixtures must not contain real API keys.

Audio bytes remain request-scoped in the upload route and transcription service. They are not written to settings storage, project markdown, sprint artifacts, logs, telemetry, or memory records.

## Upload Guardrails

`POST /api/speech/transcriptions` is excluded from the dashboard JSON parser so route-specific `multer` handling can process multipart uploads. The route stores the uploaded file in memory, accepts only supported audio MIME types, limits the upload to 25MB, and rejects audio that exceeds the supplied route-level `maxAudioSeconds` metadata. The transcription service also enforces the resolved speech setting's `maxAudioSeconds` limit before invoking any provider.

## Provider Fallback Behavior

The shared contracts distinguish configured provider mode from the provider that actually handled a transcription request:

- `local_onnx` represents local model inference.
- `external_api` represents an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

The external transcription default uses an OpenAI-compatible `/v1/audio/transcriptions` URL with an empty API key. Runtime code must treat a missing key, missing model, unsupported audio format, client permission error, and provider failure as structured error outcomes rather than generic exceptions.

In `auto` mode, Code UX checks the selected local model first. Local speech models use deterministic cache directories under `~/.code-ux/models/speech/<model-id>`, where slashes in model ids are normalized for filesystem safety. If the local model is missing and external transcription is explicitly configured with a base URL, API key, and model, the service sends the request to the external endpoint and returns fallback metadata describing the skipped local provider. If neither provider is usable, the service returns a structured 400-compatible `client_error` explaining that a local model or external credentials are required.

External requests use OpenAI-style multipart fields: `file`, `model`, and optional `language`, with bearer token authentication and a request timeout. Provider error text is sanitized before it is returned so API keys and bearer tokens are never echoed to the dashboard.

## Current Status

Implemented now:

- Shared speech settings and transcription result/error TypeScript contracts.
- System defaults for project-level speech settings.
- Settings validation and sanitization for provider mode, strings, duration bounds, and optional language normalization.
- `POST /api/speech/transcriptions` multipart upload route.
- Speech transcription service with local ONNX availability checks, external API transcription, `auto` fallback behavior, and structured errors.
- Deterministic local speech model catalog/cache paths.

Not implemented yet:

- Dashboard recorder UI.
- Electron microphone permission handling.
