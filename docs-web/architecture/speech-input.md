# Speech Input Architecture

Speech input turns dashboard microphone or uploaded audio into prompt text through `POST /api/speech/transcriptions`. Install and activate local models, or configure the API variant, under **Settings -> AI Models**.

## Settings Boundary

Speech settings are project-scoped. They flow through defaults, override resolution, validation, and sanitization alongside other project settings. The `speech` object stores whether transcription is enabled, the explicit Local or API provider mode, local ONNX model id, maximum audio duration, and external transcription configuration.

Local is the default provider mode. API fields stay hidden until API is selected, and local mode never sends microphone audio to an external provider.

## Privacy Boundary

Microphone audio must not enter runtime memory automatically. Capture flows must require an explicit user gesture and permission grant. Settings may store provider configuration, model ids, endpoint URL, and optional language, but defaults and examples must not include real API keys. Local Whisper and external API language hints are stored independently so changing providers cannot leak a stale, incompatible hint into the other runtime.

Audio bytes should remain request-scoped. They should not be written to settings, project artifacts, logs, telemetry, or memory records unless a separate retention feature is designed with user-visible consent and deletion controls.

The npm-served dashboard relies on browser secure-context treatment for loopback HTTP origins such as `http://localhost:<port>` and `http://127.0.0.1:<port>`. Packaged Electron grants microphone access only to the resolved dashboard origin and its loopback alias. Electron `media` permission requests and checks are allowed only when their details identify audio-only capture. Sprint preview origins, unrelated origins, camera/video capture, geolocation, notifications, and arbitrary Electron permissions are denied.

## Upload Guardrails

The transcription endpoint is handled by route-specific `multer` middleware, not the dashboard JSON parser. It stores the uploaded file in memory, accepts only supported audio MIME types, applies a 25MB upload limit, and rejects requests that exceed supplied route-level `maxAudioSeconds` metadata. The backend service also enforces the resolved speech setting's `maxAudioSeconds` before invoking a provider.

## Dashboard Primitives

Reusable v2 primitives keep microphone capture out of individual composers:

- `speech-recorder.ts` requests microphone access, records mono audio, emits WAV/PCM with Web Audio when available, falls back to `MediaRecorder`, and cleans up tracks/audio nodes on stop, abort, error, and unmount paths.
- `speech-api.ts` posts multipart audio to `POST /api/speech/transcriptions` with optional `projectId` and `sprintId` scope and returns the shared typed transcription result.
- `SpeechInputButton.tsx` presents permission, recording, transcribing, success, unsupported, and error states while delegating transcript insertion to parent composers.

Composer integration remains separate so each composer can choose append/replace behavior, request scope, and focus handling.

## Provider Selection

The contracts expose two explicit execution modes:

- `local_onnx` is local model inference.
- `external_api` is an OpenAI-compatible transcription endpoint.

Structured transcription errors cover unsupported audio, missing local models, permission/client errors, and provider failures.

Local model files are resolved under deterministic cache directories in `~/.code-ux/models/speech/<sanitized-model-id>`. Whisper Base English remains the default, with Whisper Tiny English as the faster, lower-footprint English alternative. The catalog also offers pinned multilingual Whisper Base and Tiny ONNX bundles. Each multilingual entry exposes its supported language codes and automatic-detection capability so dashboard clients can build a catalog-driven language selector without maintaining a second language list.

For multilingual inference, a configured language inserts the matching Whisper language token into the decoder prompt. Auto mode scores only the language tokens declared by the pinned generation configuration on the first audible chunk, reuses that selection for later chunks, and returns the detected language code with the transcript. Nullable `forced_decoder_ids` are resolved deliberately and are never coerced into token zero. English-only checkpoints keep their existing fixed English prompt and result behavior.

Recordings longer than 30 seconds use one-second overlapping windows with repeated boundary words deduplicated. A low-energy silence gate avoids hallucinated text for empty microphone input, and native inference sessions are released after each request. Before local inference, the service decodes the dashboard recorder's PCM WAV payload into mono `Float32Array` samples so the model input is audio waveform data rather than raw RIFF/container bytes. A missing local model produces a structured error without API fallback. API mode uses an OpenAI-style multipart request with bearer token auth. Provider error messages are sanitized before returning to the dashboard so API keys are never echoed.

Every STT download requires explicit acceptance of the catalog's approved commercial-use license and provenance notice. The backend validates the current license identifier before starting a direct upstream download. The multilingual conversions point back to the MIT-licensed OpenAI Whisper weights, use immutable ONNX Community revisions, and integrity-check every downloaded artifact against its cataloged SHA-256 digest.

Electron packages include the `onnxruntime-node` runtime dependency and unpack its native bindings from ASAR, but model weights remain user-cache data under `~/.code-ux/models/speech/` to avoid bloating installers and to let users replace or add models independently.
