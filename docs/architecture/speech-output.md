# Speech Output Architecture

Speech output turns project-manager replies into audio through `POST /api/speech/synthesis`. The runtime supports local ONNX synthesis and OpenAI-compatible TTS APIs, while the 3D Chat surface owns playback and the user-facing voice toggle.

## Settings And Activation

Text-to-speech configuration lives under `speech.synthesis` in normal system/project settings. It stores the enabled state, `local_onnx` or `external_api` provider mode, local model id, voice, speed, and external endpoint credentials. Settings -> AI Models is the owner of the catalog and configuration UI. Local is the default; API fields are rendered only when API is selected.

Model files are installed globally under `~/.code-ux/models/speech/<sanitized-model-id>`, but activation follows the current settings scope. Activating an installed TTS model selects its default voice, sets provider mode to `local_onnx`, and enables synthesis. The normal **Save Changes** action persists that draft.

## Built-In Local Models

| Family | Default bundle | Runtime behavior |
| --- | --- | --- |
| Kokoro | `kokoro-82m-v1.0-q8` | Quantized ONNX model, tokenizer, and five English voice embeddings. The adapter sends token ids, the selected 256-value style vector, and speed to ONNX Runtime and returns 24 kHz mono WAV. |
| Piper | `piper-en-us-lessac-medium`, `piper-en-gb-alba-medium` | Voice ONNX plus its JSON phoneme map. The adapter sends phoneme ids, lengths, and synthesis scales to ONNX Runtime and returns mono WAV at the configured sample rate. |

Both adapters use `espeak-ng` for grapheme-to-phoneme conversion when it is available. Minimal installations fall back to each bundle's grapheme vocabulary so synthesis remains available, with lower pronunciation quality for unusual words.

## External API

The external provider sends an authenticated JSON request to an OpenAI-compatible `/audio/speech` endpoint with `model`, `input`, `voice`, `response_format`, and `speed`. The response body is passed through as audio. API keys and provider error text are redacted before errors reach the dashboard.

Provider selection is explicit: local mode never sends text to an external provider, and API mode never attempts local synthesis. Text is bounded to 8,000 characters per request, requests have a timeout, and generated audio is returned with `Cache-Control: no-store`.

## 3D Chat Playback

3D Chat watches for a newly completed project-manager message. When voice is enabled, it removes Markdown-only decoration, requests audio for the active project scope, stops any previous clip, and plays the new response. Existing history is not spoken when the stage first opens.

The avatar nameplate includes a compact microphone button and volume icon, outside the composer. Dictation uses the same caret-aware insertion behavior as Threads mode. Voice defaults on when saved TTS settings are active. Muting stops playback immediately and stores a per-project browser preference; it does not disable the saved TTS model for other clients. If no TTS model/API is active, the volume icon is disabled and its accessible help points the operator to Settings -> AI Models.

## Model Management API

- `GET /api/speech/models` lists STT and TTS entries with installation and progress state.
- `POST /api/speech/models/:modelId/download` starts a background bundle download.
- `POST /api/speech/models/:modelId/cancel` cancels an in-flight download.
- `DELETE /api/speech/models/:modelId` removes the local bundle.
- `POST /api/speech/synthesis` resolves scoped settings and returns audio bytes.

Downloads use fixed Hugging Face repositories and file manifests. Partial files use a `.part` suffix and are removed after failure. Local weights stay outside npm/Electron packages so application upgrades do not duplicate or replace user model caches.

## Related Documentation

- [Speech Input Architecture](./speech-input.md)
- [Settings Reference](../settings/index.md)
- [System Overview](./system-overview.md)
