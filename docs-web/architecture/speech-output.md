# Speech Output Architecture

Speech output turns project-manager replies into audio through `POST /api/speech/synthesis`. Code UX supports local ONNX synthesis and OpenAI-compatible TTS APIs, and 3D Chat provides playback plus a voice on/off control.

## Configure and activate

Open **Settings -> AI Models**. The compact Local AI Runtime summary keeps provider and model choices out of the main page flow. **Configure speech** opens provider, language, voice, speed, and optional API fields; **Manage local models** opens the searchable speech and memory catalog. Downloads are shared across projects; speech activation follows the current System or Project scope and is persisted with **Save Changes**.

Local is the default for TTS and API fields stay hidden until API is selected. Activating a downloaded TTS model selects its default voice, switches to Local, and enables synthesis. Provider selection is explicit, so Local never sends reply text to an external API.

## Local model families

| Family | Included choices | Notes |
| --- | --- | --- |
| Kokoro | Kokoro 82M v1.0 Q8 | Apache-2.0 multi-voice English output, five lightweight voices, pinned CC BY training-data attribution, and an integrity-pinned phonemizer, roughly 98 MB. |
| Piper | LJSpeech Medium, Cori Medium | MIT-cataloged American and British voices trained from scratch with public-domain data, roughly 65 MB each. |

Models run through the packaged `onnxruntime-node` dependency. The opt-in phonemizer runs as a separate process and supplies the IPA expected by Kokoro and Piper. Its wrapper is Apache-2.0 and its embedded eSpeak NG engine is GPL-3.0-or-later; both notices are stored beside the runtime and named in the aggregate acceptance. The current synthesis catalog and adapters support English only, so unsupported multilingual voices stay out of the catalog. There is no raw spelling fallback: a missing or invalid phonemizer stops synthesis with a repair message instead of producing unintelligible speech.

## License acceptance

Every downloadable speech model shows its upstream terms, provenance, commercial-use status, and download size. **Accept & Download** sends the current stable license identifier to the server, which rejects missing or outdated acceptance. Artifacts download directly from upstream into the user cache and are not bundled with Code UX.

The catalog excludes non-commercial and research-only models. Piper LJSpeech and Cori replace Lessac and Alba because they were trained from scratch using public-domain data. Kokoro installs its pinned upstream model card and surfaces its Koniwa CC BY 3.0 and SIWIS CC BY 4.0 attribution requirements. Executable runtime downloads are SHA-256 verified, and license/model-card notices are stored beside their artifacts. GPL source and redistribution obligations still apply when an operator redistributes the downloaded eSpeak runtime.

## API TTS

The external variant uses an OpenAI-compatible `/audio/speech` endpoint. Configure the base URL, API key, model, voice, and output format under Text to speech. Code UX sends `model`, `input`, `voice`, `response_format`, and `speed`, and never caches the returned audio.

## 3D Chat voice

When TTS is active, the volume icon in the avatar nameplate control dock starts enabled. New project-manager replies are synthesized and played once; refreshing, opening existing history, or changing threads does not replay them. Before synthesis, Code UX silently removes dashboard-only rich-widget fences and fenced code while preserving the surrounding visible prose, so widget payloads and artificial omission notices are never spoken. Click the icon to mute or unmute. The adjacent microphone dictates into the 3D Chat draft. Both controls remain outside the composer. Muting stops current playback and is remembered per project in that browser without disabling the saved TTS runtime for other clients.

Assistant prose messages include a small accessible replay control in 3D Chat, Threads, and invocation transcripts. Replay is explicit in Threads and Invocations: transcript loading and live updates never start speech. Long replies play as sequential requests within the synthesis request limit, and starting another clip stops the previous clip on that surface.

## Local files and endpoints

Local weights live under `~/.code-ux/models/speech/<sanitized-model-id>`.

- `GET /api/speech/models` lists installation status.
- `POST /api/speech/models/:modelId/download` accepts the current terms and installs a bundle.
- `DELETE /api/speech/models/:modelId` removes a bundle.
- `POST /api/speech/synthesis` returns synthesized audio.

See also [Speech Input Architecture](./speech-input.md) and [Dashboard Settings](../user/dashboard/settings.md).
