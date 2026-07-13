# Speech Output Architecture

Speech output turns project-manager replies into audio through `POST /api/speech/synthesis`. Code UX supports local ONNX synthesis and OpenAI-compatible TTS APIs, and 3D Chat provides playback plus a voice on/off control.

## Configure and activate

Open **Settings -> AI Models**. The compact Local AI Runtime summary keeps provider and model choices out of the main page flow. **Configure speech** opens provider, language, voice, speed, and optional API fields; **Manage local models** opens the searchable speech and memory catalog. Downloads are shared across projects; speech activation follows the current System or Project scope and is persisted with **Save Changes**.

Local is the default for TTS and API fields stay hidden until API is selected. Activating a downloaded TTS model selects its default voice, switches to Local, and enables synthesis. Provider selection is explicit, so Local never sends reply text to an external API.

## Local model families

| Family | Included choices | Notes |
| --- | --- | --- |
| Kokoro | Kokoro 82M v1.0 Q8 | Apache-2.0 multi-voice English output, five lightweight voices, pinned CC BY training-data attribution, and an integrity-pinned phonemizer, roughly 98 MB. |
| Piper | LJSpeech Medium, Cori Medium, MLS German Medium | American and British voices trained from scratch with public-domain data, plus a German checkpoint trained from scratch on CC BY 4.0 Multilingual LibriSpeech. German MLS includes its multilingual phonemizer and is roughly 102 MB. |

Models run through the packaged `onnxruntime-node` dependency. Phonemizers run as separate processes and supply the IPA expected by Kokoro and Piper. English bundles use an Apache-2.0 wrapper with an embedded GPL-3.0-or-later eSpeak NG engine. German MLS downloads the full `@echogarden/espeak-ng-emscripten@0.3.5` runtime and language data under GPL-3.0-only because the compact English artifact cannot produce German phonemes. Inside the child process, Code UX verifies the executable runtime and German data sidecar against the catalog SHA-256 values immediately before loading code. A modified cache fails closed. There is no raw spelling fallback: a missing or modified runtime, unsupported language, or empty phoneme result stops synthesis instead of producing unintelligible speech.

## License acceptance

Every downloadable speech model shows its upstream terms, provenance, commercial-use status, and download size. **Accept & Download** sends the current stable license identifier to the server, which rejects missing or outdated acceptance. Artifacts download directly from upstream into the user cache and are not bundled with Code UX.

The catalog excludes non-commercial and research-only models. Piper LJSpeech and Cori replace Lessac and Alba because they were trained from scratch using public-domain data. German MLS is admitted because its pinned upstream model card records from-scratch training on CC BY 4.0 Multilingual LibriSpeech and the Piper Voices repository metadata is MIT. Attribution names Multilingual LibriSpeech authors Vineel Pratap, Qiantong Xu, Anuroop Sriram, Gabriel Synnaeve, and Ronan Collobert and links [OpenSLR SLR94](https://www.openslr.org/94/). The bundle installs the model card, CC BY legal text, and eSpeak runtime notice. Its GPL source is pinned to the immutable [`espeak-ng-emscripten` package commit](https://github.com/echogarden-project/espeak-ng-emscripten/tree/ea36b43595facf07f1c5dc487b9f0de3340c1b5e) and [eSpeak NG fork commit](https://github.com/echogarden-project/espeak-ng/tree/b723b62cb78f7e861a1bb4408b00d49db84afeac). Kokoro installs its pinned upstream model card and surfaces its Koniwa CC BY 3.0 and SIWIS CC BY 4.0 attribution requirements. Executable runtime downloads are SHA-256 verified, and license/model-card notices are stored beside their artifacts. GPL source and redistribution obligations still apply when an operator redistributes a downloaded eSpeak runtime.

## API TTS

The external variant uses an OpenAI-compatible `/audio/speech` endpoint. Configure the base URL, API key, model, voice, and output format under Text to speech. Code UX sends `model`, `input`, `voice`, `response_format`, and `speed`, and never caches the returned audio.

Local model and voice settings resolve as a compatible pair across system, project, and sprint scopes. If an older child-scope voice override does not exist on a newly selected inherited model, Code UX uses that model's default voice and verifies the pair again before inference.

## 3D Chat voice

When TTS is active, the volume icon in the avatar nameplate control dock starts enabled. New project-manager replies are synthesized and played once; refreshing, opening existing history, or changing threads does not replay them. Before synthesis, Code UX silently removes dashboard-only rich-widget fences and fenced code while preserving the surrounding visible prose, so widget payloads and artificial omission notices are never spoken. Click the icon to mute or unmute. The adjacent microphone dictates into the 3D Chat draft. Both controls remain outside the composer. Muting stops current playback and is remembered per project in that browser without disabling the saved TTS runtime for other clients. Synthesis or browser playback failures appear as an accessible inline voice error instead of being silently ignored.

Assistant prose messages include a small accessible replay control in 3D Chat, Threads, and invocation transcripts. Replay is explicit in Threads and Invocations: transcript loading and live updates never start speech. For long replies, the first complete sentence is synthesized immediately and begins playing as soon as it is ready. While it plays, Code UX prefetches at most two later chunks, retains results by index, and plays only the next contiguous chunk. Later sentences are grouped when they fit, and oversized or unpunctuated passages use bounded word-aware splits. Every request stays within the 8,000-character synthesis limit without reordering or omitting spoken content.

Stopping, muting, starting another replay, changing thread or Chat mode, or leaving the surface aborts pending synthesis and releases active audio resources. Late results cannot restart a cancelled run. A synthesis or browser playback failure stops the ordered run and appears in the surface's accessible voice or transcript status without hiding the written reply.

## Local files and endpoints

Local weights live under `~/.code-ux/models/speech/<sanitized-model-id>`.

- `GET /api/speech/models` lists installation status.
- `POST /api/speech/models/:modelId/download` accepts the current terms and installs a bundle.
- `DELETE /api/speech/models/:modelId` removes a bundle.
- `POST /api/speech/synthesis` returns synthesized audio.

See also [Speech Input Architecture](./speech-input.md) and [Dashboard Settings](../user/dashboard/settings.md).
