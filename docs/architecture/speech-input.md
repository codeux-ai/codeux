# Speech Input Architecture

Speech input turns dashboard microphone or uploaded audio into prompt text through `POST /api/speech/transcriptions`. Settings -> AI Models owns speech-model installation, activation, and local/API configuration alongside the TTS catalog.

## Settings Boundary

Speech settings are project-scoped and flow through the same defaults, override resolution, validation, and sanitization path as memory settings. The persisted `speech` object controls whether transcription is enabled, whether local ONNX or an external API is selected, the local model id, a bounded maximum audio duration, and external transcription configuration.

The default provider mode is `local_onnx`. API fields stay hidden until `external_api` is selected, and provider selection is strict: local mode does not send audio externally.

## Privacy Boundary

Actual microphone audio must not enter runtime memory automatically. Recorder UI or Electron shell integration must require an explicit user gesture and permission grant before capturing audio. Persisted settings store only configuration values such as provider mode, model ids, endpoint URL, and optional language; defaults and fixtures must not contain real API keys.

Audio bytes should remain request-scoped. They should not be written to settings storage, project markdown, sprint artifacts, logs, telemetry, or memory records unless a future task explicitly introduces a user-visible retention feature with separate consent and deletion controls.

The npm-served dashboard relies on browser secure-context treatment for loopback HTTP origins such as `http://localhost:<port>` and `http://127.0.0.1:<port>`. Packaged Electron grants microphone access only to the resolved dashboard origin and its loopback alias. Electron `media` permission requests and checks are allowed only when their details identify audio-only capture. Sprint preview origins, unrelated origins, camera/video capture, geolocation, notifications, and arbitrary Electron permissions are denied.

## Upload Guardrails

`POST /api/speech/transcriptions` is excluded from the dashboard JSON parser so route-specific `multer` handling can process multipart uploads. The route stores the uploaded file in memory, accepts only supported audio MIME types, limits the upload to 25MB, and rejects audio that exceeds the supplied route-level `maxAudioSeconds` metadata. The transcription service also enforces the resolved speech setting's `maxAudioSeconds` limit before invoking any provider.

## Dashboard Primitives

The dashboard exposes reusable v2 speech primitives instead of wiring microphone capture directly into individual composers:

- `dashboard/src/v2/lib/speech-recorder.ts` requests microphone access, records mono audio, encodes WAV/PCM through Web Audio when available, falls back to `MediaRecorder` when necessary, and stops tracks/audio nodes on stop, abort, error, and unmount paths.
- `dashboard/src/v2/lib/speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` with dashboard metadata, including optional `projectId` and `sprintId` scope, and returns the shared typed transcription result.
- `dashboard/src/v2/components/speech/SpeechInputButton.tsx` owns permission, recording, transcribing, success, unsupported, and error states. It delegates transcript insertion to parent composers through `onTranscript` and reports structured recorder/transcription errors through `onError`.

Composer integration remains intentionally separate so each composer can decide whether to append or replace text, which project or sprint scope applies to the request, and how to handle focus restoration.

## Provider Selection

The shared contracts use two explicit provider modes:

- `local_onnx` represents local model inference.
- `external_api` represents an OpenAI-compatible transcription endpoint.

The external transcription default uses an OpenAI-compatible `/v1/audio/transcriptions` URL with an empty API key. Runtime code must treat a missing key, missing model, unsupported audio format, client permission error, and provider failure as structured error outcomes rather than generic exceptions.

Local speech bundles use deterministic cache directories under `~/.code-ux/models/speech/<sanitized-model-id>`, where slashes in model ids are normalized for filesystem safety. Whisper Base English is the default and runs its encoder-decoder bundle entirely through `onnxruntime-node`; recordings longer than the model's 30-second window use one-second overlapping chunks with repeated boundary words deduplicated, without sending audio elsewhere. A low-energy silence gate prevents empty microphone input from being forced into hallucinated text, and native inference sessions are released after each request. Whisper Tiny is the faster local alternative. The legacy Wav2Vec2 Base id remains supported for existing settings and low-latency use: its waveform is resampled, zero-mean/unit-variance normalized as required by the upstream feature extractor, greedily CTC-decoded, and lowercased for readable output. Before local inference, the service decodes the dashboard recorder's PCM WAV payload into mono `Float32Array` samples. A missing local model returns a structured error without invoking the configured API; API requests occur only in `external_api` mode.

All STT downloads are opt-in and use the same license gate as TTS and embedding models. The catalog exposes approved commercial-use terms and provenance, the operator explicitly accepts the current license identifier, and the server rejects missing or stale acceptance before starting a download.

External requests use OpenAI-style multipart fields: `file`, `model`, and optional `language`, with bearer token authentication and a request timeout. Provider error text is sanitized before it is returned so API keys and bearer tokens are never echoed to the dashboard.

Electron packages include the `onnxruntime-node` runtime dependency and unpack its native bindings from ASAR, but model weights remain user-cache data under `~/.code-ux/models/speech/` to avoid bloating installers and to let users replace or add models independently.

## Current Status

Implemented now:

- Shared speech settings and transcription result/error TypeScript contracts.
- System defaults for project-level speech settings.
- Settings validation and sanitization for provider mode, strings, duration bounds, and optional language normalization.
- `POST /api/speech/transcriptions` multipart upload route.
- Speech transcription service with explicit local ONNX or external API execution and structured errors.
- Deterministic local speech model catalog/cache paths.
- Shared dashboard recorder, transcription API client, and speech input button primitives.
- Electron microphone permission handling for the trusted dashboard origin.
- Composer-level speech input wiring in Threads and a compact microphone control on the 3D avatar stage.
