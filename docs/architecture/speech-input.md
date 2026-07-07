# Speech Input Architecture

Speech input is a dashboard capability for turning microphone audio into prompt text. This page documents the persisted settings, shared request/response contracts, and reusable dashboard primitives that support recorder UI integration.

## Settings Boundary

Speech settings are project-scoped and flow through the same settings defaults, override resolution, validation, and sanitization path as memory settings. The persisted `speech` object controls whether transcription is enabled, which provider mode is preferred, the local ONNX model id, a bounded maximum audio duration, and an external transcription fallback endpoint.

The default provider mode is `auto`. In auto mode, runtime implementation should prefer the local ONNX transcription provider first and use the external API provider only as an explicit fallback when local transcription is unavailable or cannot satisfy the request.

## Privacy Boundary

Actual microphone audio must not enter runtime memory automatically. Recorder UI and Electron shell integration must require an explicit user gesture and permission grant before capturing audio. Persisted settings store only configuration values such as provider mode, model ids, endpoint URL, and optional language; defaults and fixtures must not contain real API keys.

Audio bytes should remain request-scoped. They should not be written to settings storage, project markdown, sprint artifacts, logs, telemetry, or memory records unless a future task explicitly introduces a user-visible retention feature with separate consent and deletion controls.

## Dashboard Primitives

The dashboard exposes reusable v2 speech primitives instead of wiring microphone capture directly into individual composers:

- `dashboard/src/v2/lib/speech-recorder.ts` requests microphone access, records mono audio, encodes WAV/PCM through Web Audio when available, falls back to `MediaRecorder` when necessary, and stops tracks/audio nodes on stop, abort, error, and unmount paths.
- `dashboard/src/v2/lib/speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` with dashboard metadata and returns the shared typed transcription result.
- `dashboard/src/v2/components/speech/SpeechInputButton.tsx` owns permission, recording, transcribing, success, unsupported, and error states. It delegates transcript insertion to parent composers through `onTranscript` and reports structured recorder/transcription errors through `onError`.

Composer integration remains intentionally separate so each composer can decide whether to append or replace text and how to handle focus restoration.

## Provider Fallback Behavior

The shared contracts distinguish configured provider mode from the provider that actually handled a transcription request:

- `local_onnx` represents local model inference.
- `external_api` represents an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

The external transcription default uses an OpenAI-compatible `/v1/audio/transcriptions` URL with an empty API key. Runtime code must treat a missing key, missing model, unsupported audio format, client permission error, and provider failure as structured error outcomes rather than generic exceptions.

## Current Status

Implemented now:

- Shared speech settings and transcription result/error TypeScript contracts.
- System defaults for project-level speech settings.
- Settings validation and sanitization for provider mode, strings, duration bounds, and optional language normalization.
- Shared dashboard recorder, transcription API client, and speech input button primitives.

Not implemented yet:

- Local ONNX inference.
- Electron microphone permission handling.
- Composer-level speech input wiring.
