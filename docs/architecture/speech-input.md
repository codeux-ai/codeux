# Speech Input Architecture

Speech input turns dashboard microphone or uploaded audio into prompt text through `POST /api/speech/transcriptions`. The current implementation includes persisted settings, the backend transcription route and service, and reusable dashboard primitives for recorder-driven transcription.

## Settings Boundary

Speech settings are project-scoped and flow through the same defaults, override resolution, validation, and sanitization path as memory settings. The persisted `speech` object controls whether transcription is enabled, which provider mode is preferred, the local ONNX model id, a bounded maximum audio duration, and an external transcription fallback endpoint.

The default provider mode is `auto`. In auto mode, runtime implementation should prefer local ONNX transcription first and use the external API provider only as an explicit fallback when local transcription is unavailable or cannot satisfy the request.

## Privacy Boundary

Actual microphone audio must not enter runtime memory automatically. Recorder UI or Electron shell integration must require an explicit user gesture and permission grant before capturing audio. Persisted settings store only configuration values such as provider mode, model ids, endpoint URL, and optional language; defaults and fixtures must not contain real API keys.

Audio bytes should remain request-scoped. They should not be written to settings storage, project markdown, sprint artifacts, logs, telemetry, or memory records unless a future task explicitly introduces a user-visible retention feature with separate consent and deletion controls.

The npm-served dashboard relies on browser secure-context treatment for loopback HTTP origins such as `http://localhost:<port>` and `http://127.0.0.1:<port>`. Packaged Electron grants microphone access only to the resolved dashboard origin and its loopback alias. Sprint preview origins, unrelated origins, camera/video capture, geolocation, notifications, and arbitrary Electron permissions are denied.

## Upload Guardrails

`POST /api/speech/transcriptions` is excluded from the dashboard JSON parser so route-specific `multer` handling can process multipart uploads. The route stores the uploaded file in memory, accepts only supported audio MIME types, limits the upload to 25MB, and rejects audio that exceeds the supplied route-level `maxAudioSeconds` metadata. The transcription service also enforces the resolved speech setting's `maxAudioSeconds` limit before invoking any provider.

## Dashboard Primitives

The dashboard exposes reusable v2 speech primitives instead of wiring microphone capture directly into individual composers:

- `dashboard/src/v2/lib/speech-recorder.ts` requests microphone access, records mono audio, encodes WAV/PCM through Web Audio when available, falls back to `MediaRecorder` when necessary, and stops tracks/audio nodes on stop, abort, error, and unmount paths.
- `dashboard/src/v2/lib/speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` with dashboard metadata, including optional `projectId` and `sprintId` scope, and returns the shared typed transcription result.
- `dashboard/src/v2/components/speech/SpeechInputButton.tsx` owns permission, recording, transcribing, success, unsupported, and error states. It delegates transcript insertion to parent composers through `onTranscript` and reports structured recorder/transcription errors through `onError`.

Composer integration remains intentionally separate so each composer can decide whether to append or replace text, which project or sprint scope applies to the request, and how to handle focus restoration.

## Provider Fallback Behavior

The shared contracts distinguish configured provider mode from the provider that actually handled a transcription request:

- `local_onnx` represents local model inference.
- `external_api` represents an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

The external transcription default uses an OpenAI-compatible `/v1/audio/transcriptions` URL with an empty API key. Runtime code must treat a missing key, missing model, unsupported audio format, client permission error, and provider failure as structured error outcomes rather than generic exceptions.

In `auto` mode, Code UX checks the selected local model first. Local speech models use deterministic cache directories under `~/.code-ux/models/speech/<sanitized-model-id>`, where slashes in model ids are normalized for filesystem safety; the default `onnx-community/whisper-base.en` resolves to `~/.code-ux/models/speech/onnx-community--whisper-base.en/`. Each model directory must contain `model.onnx` and may include `labels.json`. Before local ONNX inference, the service decodes the dashboard recorder's PCM WAV payload into mono `Float32Array` samples so the model input is audio waveform data rather than raw RIFF/container bytes. If the local model is missing and external transcription is explicitly configured with a base URL, API key, and model, the service sends the original upload to the external endpoint and returns fallback metadata describing the skipped local provider. If neither provider is usable, the service returns a structured 400-compatible `client_error` explaining that a local model or external credentials are required.

External requests use OpenAI-style multipart fields: `file`, `model`, and optional `language`, with bearer token authentication and a request timeout. Provider error text is sanitized before it is returned so API keys and bearer tokens are never echoed to the dashboard.

Electron packages include the `onnxruntime-node` runtime dependency and unpack its native bindings from ASAR, but model weights remain user-cache data under `~/.code-ux/models/speech/` to avoid bloating installers and to let users replace or add models independently.

## Current Status

Implemented now:

- Shared speech settings and transcription result/error TypeScript contracts.
- System defaults for project-level speech settings.
- Settings validation and sanitization for provider mode, strings, duration bounds, and optional language normalization.
- `POST /api/speech/transcriptions` multipart upload route.
- Speech transcription service with local ONNX inference, external API transcription, `auto` fallback behavior, and structured errors.
- Deterministic local speech model catalog/cache paths.
- Shared dashboard recorder, transcription API client, and speech input button primitives.
- Electron microphone permission handling for the trusted dashboard origin.
- Composer-level speech input wiring.
