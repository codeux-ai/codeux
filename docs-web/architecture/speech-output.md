# Speech Output Architecture

Speech output turns project-manager replies into audio through `POST /api/speech/synthesis`. Code UX supports local ONNX synthesis and OpenAI-compatible TTS APIs, and 3D Chat provides playback plus a voice on/off control.

## Configure and activate

Open **Settings -> AI Models**. The Speech Runtime card configures provider mode, voice, speed, and optional API credentials. The Speech Model Catalog installs local bundles. Downloads are shared across projects; activation follows the current System or Project scope and is persisted with **Save Changes**.

Local is the default for TTS and API fields stay hidden until API is selected. Activating a downloaded TTS model selects its default voice, switches to Local, and enables synthesis. Provider selection is explicit, so Local never sends reply text to an external API.

## Local model families

| Family | Included choices | Notes |
| --- | --- | --- |
| Kokoro | Kokoro 82M v1.0 Q8 | Natural multi-voice English output, five bundled voices, roughly 95 MB. |
| Piper | Lessac Medium, Alba Medium | Efficient American and British English voices, roughly 63 MB each. |

Models run through the packaged `onnxruntime-node` dependency. `espeak-ng` improves phonemization when installed; a built-in grapheme fallback keeps minimal desktop/container installations usable.

## API TTS

The external variant uses an OpenAI-compatible `/audio/speech` endpoint. Configure the base URL, API key, model, voice, and output format under Text to speech. Code UX sends `model`, `input`, `voice`, `response_format`, and `speed`, and never caches the returned audio.

## 3D Chat voice

When TTS is active, the volume icon in the avatar nameplate control dock starts enabled. New project-manager replies are synthesized and played automatically; opening existing history does not replay it. Click the icon to mute or unmute. The adjacent microphone dictates into the 3D Chat draft. Both controls remain outside the composer. Muting stops current playback and is remembered per project in that browser without disabling the saved TTS runtime for other clients.

## Local files and endpoints

Local weights live under `~/.code-ux/models/speech/<sanitized-model-id>`.

- `GET /api/speech/models` lists installation status.
- `POST /api/speech/models/:modelId/download` installs a bundle.
- `DELETE /api/speech/models/:modelId` removes a bundle.
- `POST /api/speech/synthesis` returns synthesized audio.

See also [Speech Input Architecture](./speech-input.md) and [Dashboard Settings](../user/dashboard/settings.md).
