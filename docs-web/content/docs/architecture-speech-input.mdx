# Speech Input Architecture

Speech input turns dashboard microphone or uploaded audio into prompt text through `POST /api/speech/transcriptions`. The current implementation includes persisted settings, the backend transcription route and service, and reusable dashboard primitives for recorder-driven transcription.

## Settings Boundary

Speech settings are project-scoped. They flow through defaults, override resolution, validation, and sanitization alongside other project settings. The `speech` object stores whether transcription is enabled, the provider mode, local ONNX model id, maximum audio duration, and external transcription fallback configuration.

The default provider mode is `auto`, which is intended to prefer local ONNX transcription first and fall back to an OpenAI-compatible external API only when local transcription is unavailable.

## Privacy Boundary

Microphone audio must not enter runtime memory automatically. Capture flows must require an explicit user gesture and permission grant. Settings may store provider configuration, model ids, endpoint URL, and optional language, but defaults and examples must not include real API keys.

Audio bytes should remain request-scoped. They should not be written to settings, project artifacts, logs, telemetry, or memory records unless a separate retention feature is designed with user-visible consent and deletion controls.

The npm-served dashboard relies on browser secure-context treatment for loopback HTTP origins such as `http://localhost:<port>` and `http://127.0.0.1:<port>`. Packaged Electron grants microphone access only to the resolved dashboard origin and its loopback alias. Sprint preview origins, unrelated origins, camera/video capture, geolocation, notifications, and arbitrary Electron permissions are denied.

## Upload Guardrails

The transcription endpoint is handled by route-specific `multer` middleware, not the dashboard JSON parser. It stores the uploaded file in memory, accepts only supported audio MIME types, applies a 25MB upload limit, and rejects requests that exceed supplied route-level `maxAudioSeconds` metadata. The backend service also enforces the resolved speech setting's `maxAudioSeconds` before invoking a provider.

## Dashboard Primitives

Reusable v2 primitives keep microphone capture out of individual composers:

- `speech-recorder.ts` requests microphone access, records mono audio, emits WAV/PCM with Web Audio when available, falls back to `MediaRecorder`, and cleans up tracks/audio nodes on stop, abort, error, and unmount paths.
- `speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` with optional `projectId` and `sprintId` scope and returns the shared typed transcription result.
- `SpeechInputButton.tsx` presents permission, recording, transcribing, success, unsupported, and error states while delegating transcript insertion to parent composers.

Composer integration remains separate so each composer can choose append/replace behavior, request scope, and focus handling.

## Provider Fallback Behavior

The contracts separate settings mode from execution provider:

- `local_onnx` is local model inference.
- `external_api` is an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

Structured transcription errors cover unsupported audio, missing local models, permission/client errors, and provider failures.

Local model files are resolved under deterministic cache directories in `~/.code-ux/models/speech/<sanitized-model-id>`. The default `onnx-community/whisper-base.en` resolves to `~/.code-ux/models/speech/onnx-community--whisper-base.en/`; each model directory must contain `model.onnx` and may include `labels.json`. In `auto` mode, Code UX uses local ONNX first when the selected model is present. Before local inference, the service decodes the dashboard recorder's PCM WAV payload into mono `Float32Array` samples so the model input is audio waveform data rather than raw RIFF/container bytes. If the model is missing and an external base URL, API key, and model are configured, the service falls back to an OpenAI-style multipart request using bearer token auth and returns fallback metadata. Provider error messages are sanitized before returning to the dashboard so API keys are never echoed.

Electron packages include the `onnxruntime-node` runtime dependency and unpack its native bindings from ASAR, but model weights remain user-cache data under `~/.code-ux/models/speech/` to avoid bloating installers and to let users replace or add models independently.
