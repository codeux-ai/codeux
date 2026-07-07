# Speech Input Architecture

Speech input is a dashboard capability for turning microphone audio into prompt text. The current implementation includes persisted settings, shared TypeScript contracts, and reusable dashboard primitives for recorder-driven transcription.

## Settings Boundary

Speech settings are project-scoped. They flow through defaults, override resolution, validation, and sanitization alongside other project settings. The `speech` object stores whether transcription is enabled, the provider mode, local ONNX model id, maximum audio duration, and external transcription fallback configuration.

The default provider mode is `auto`, which is intended to prefer local ONNX transcription first and fall back to an OpenAI-compatible external API only when local transcription is unavailable.

## Privacy Boundary

Microphone audio must not enter runtime memory automatically. Capture flows must require an explicit user gesture and permission grant. Settings may store provider configuration, model ids, endpoint URL, and optional language, but defaults and examples must not include real API keys.

Audio bytes should remain request-scoped. They should not be written to settings, project artifacts, logs, telemetry, or memory records unless a separate retention feature is designed with user-visible consent and deletion controls.

## Dashboard Primitives

Reusable v2 primitives keep microphone capture out of individual composers:

- `speech-recorder.ts` requests microphone access, records mono audio, emits WAV/PCM with Web Audio when available, falls back to `MediaRecorder`, and cleans up tracks/audio nodes on stop, abort, error, and unmount paths.
- `speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` and returns the shared typed transcription result.
- `SpeechInputButton.tsx` presents permission, recording, transcribing, success, unsupported, and error states while delegating transcript insertion to parent composers.

Composer integration remains separate so each composer can choose append/replace behavior and focus handling.

## Provider Fallback Behavior

The contracts separate settings mode from execution provider:

- `local_onnx` is local model inference.
- `external_api` is an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

Structured transcription errors cover unsupported audio, missing local models, permission/client errors, and provider failures.
