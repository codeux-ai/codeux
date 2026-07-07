# Speech Input Architecture

Speech input is a planned dashboard capability for turning microphone audio into prompt text. The current implementation only includes persisted settings and shared TypeScript contracts; it does not include recorder UI, upload routes, ONNX inference, Electron permission handling, or provider calls.

## Settings Boundary

Speech settings are project-scoped. They flow through defaults, override resolution, validation, and sanitization alongside other project settings. The `speech` object stores whether transcription is enabled, the provider mode, local ONNX model id, maximum audio duration, and external transcription fallback configuration.

The default provider mode is `auto`, which is intended to prefer local ONNX transcription first and fall back to an OpenAI-compatible external API only when local transcription is unavailable.

## Privacy Boundary

Microphone audio must not enter runtime memory automatically. Future capture flows must require an explicit user gesture and permission grant. Settings may store provider configuration, model ids, endpoint URL, and optional language, but defaults and examples must not include real API keys.

Audio bytes should remain request-scoped when runtime support is added. They should not be written to settings, project artifacts, logs, telemetry, or memory records unless a separate retention feature is designed with user-visible consent and deletion controls.

## Provider Fallback Behavior

The contracts separate settings mode from execution provider:

- `local_onnx` is local model inference.
- `external_api` is an OpenAI-compatible transcription endpoint.
- `auto` is a settings mode, not a concrete execution provider.

Structured transcription errors cover unsupported audio, missing local models, permission/client errors, and provider failures.
