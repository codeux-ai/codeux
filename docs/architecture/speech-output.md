# Speech Output Architecture

Speech output turns project-manager replies into audio through `POST /api/speech/synthesis`. The runtime supports local ONNX synthesis and OpenAI-compatible TTS APIs, while the 3D Chat surface owns playback and the user-facing voice toggle.

## Settings And Activation

Text-to-speech configuration lives under `speech.synthesis` in normal system/project settings. It stores the enabled state, `local_onnx` or `external_api` provider mode, local model id, voice, speed, and external endpoint credentials. Settings -> AI Models is the owner of the catalog and configuration UI. Local is the default; API fields are rendered only when API is selected.

Model files are installed globally under `~/.code-ux/models/speech/<sanitized-model-id>`, but activation follows the current settings scope. Activating an installed TTS model selects its default voice, sets provider mode to `local_onnx`, and enables synthesis. The normal **Save Changes** action persists that draft.

## Built-In Local Models

| Family | Default bundle | Runtime behavior |
| --- | --- | --- |
| Kokoro | `kokoro-82m-v1.0-q8` | Apache-2.0 quantized ONNX model, tokenizer, five lightweight English voice embeddings, pinned upstream CC BY training-data attribution, and an integrity-pinned phonemizer runtime. The adapter sends IPA token ids, the selected 256-value style vector, and speed to ONNX Runtime and returns 24 kHz mono WAV. |
| Piper | `piper-en-us-ljspeech-medium`, `piper-en-gb-cori-medium`, `piper-de-de-mls-medium` | English ONNX bundles trained from scratch with public-domain LJSpeech or LibriVox data, plus the German MLS medium checkpoint trained from scratch on CC BY 4.0 Multilingual LibriSpeech. The adapter maps the selected catalog voice to the checkpoint speaker id and returns mono WAV at the configured sample rate. German MLS exposes one curated default from its 236 speakers to keep first-time setup simple. |

Both adapters phonemize text in a separate Node process. English bundles use the integrity-pinned `phonemizer@1.2.1` wrapper under Apache-2.0 with its embedded GPL-3.0-or-later eSpeak NG engine. German MLS instead downloads the integrity-pinned `@echogarden/espeak-ng-emscripten@0.3.5` JavaScript runtime and its full multilingual data sidecar under GPL-3.0-only. This separate runtime is required because the compact English artifact does not produce German phonemes. Inside the child process, Code UX hashes the executable runtime and, for German, its data sidecar against the catalog SHA-256 values immediately before `require` or dynamic import. A modified cache therefore fails closed before executable code is loaded. The German adapter removes eSpeak trace separators before applying Piper's own configured padding ids. Kokoro applies English-specific normalization and IPA compatibility fixes before tokenization. Synthesis fails closed with a repair message when the required runtime is absent, modified, rejects the language, or returns no supported tokens; it never feeds raw spelling into a phoneme-trained model.

## License Acceptance And Provenance

Every built-in downloadable speech entry declares a stable aggregate license identifier, an HTTPS terms link, commercial-use eligibility, source provenance, and a notice. Catalog initialization rejects incomplete metadata or licenses that do not permit commercial use. The dashboard shows these details and requires **Accept & Download** for the current identifier; the server independently rejects a missing or stale acceptance. Permissive model weights do not hide executable-runtime, training-data, or voice-data terms: Kokoro stores its pinned upstream model card and identifies Koniwa CC BY 3.0 plus SIWIS CC BY 4.0 attribution. English Kokoro/Piper entries include the Apache phonemizer and GPL eSpeak notices. German MLS installs the immutable Piper voice-repository metadata, its model card, the CC BY 4.0 legal text, and the GPL-3.0-only multilingual-runtime notices.

Downloads go directly to the user cache from their upstream repositories. Code UX does not bundle or sublicense weights, voices, or phonemizer runtimes. License and model-card notices included in a manifest are saved beside the artifacts. Piper Lessac and derivatives based on Lessac are intentionally absent because their source-data terms are research-only; LJSpeech and Cori replace the former Lessac and Alba defaults. German MLS is included because its immutable upstream model card records from-scratch training and CC BY 4.0 Multilingual LibriSpeech data; the Piper Voices repository metadata is MIT. Attribution is preserved for Multilingual LibriSpeech authors Vineel Pratap, Qiantong Xu, Anuroop Sriram, Gabriel Synnaeve, and Ronan Collobert, with [OpenSLR SLR94](https://www.openslr.org/94/) as the source. The GPL runtime is traceable to the immutable [`espeak-ng-emscripten` package source](https://github.com/echogarden-project/espeak-ng-emscripten/tree/ea36b43595facf07f1c5dc487b9f0de3340c1b5e) and its immutable [eSpeak NG fork source](https://github.com/echogarden-project/espeak-ng/tree/b723b62cb78f7e861a1bb4408b00d49db84afeac). The model, configuration, notices, JavaScript runtime, and language-data sidecar are all SHA-256 pinned.

Downloaded executable runtime files are pinned by SHA-256. Existing non-empty model files are reused, so upgrading an older Kokoro cache downloads only newly required artifacts. A hash mismatch removes the partial file and leaves the bundle unavailable.

## External API

The external provider sends an authenticated JSON request to an OpenAI-compatible `/audio/speech` endpoint with `model`, `input`, `voice`, `response_format`, and `speed`. The response body is passed through as audio. API keys and provider error text are redacted before errors reach the dashboard.

Provider selection is explicit: local mode never sends text to an external provider, and API mode never attempts local synthesis. Text is bounded to 8,000 characters per request, requests have a timeout, and generated audio is returned with `Cache-Control: no-store`.

## 3D Chat Playback

3D Chat establishes the loaded thread as a silent history baseline, then watches for a newly appended project-manager message. When voice is enabled, it removes Markdown-only decoration, dashboard-only `codeux:*` rich-widget fences, and ordinary fenced code before requesting audio for the active project scope. Those non-spoken blocks are removed silently: neither their payloads nor an artificial "output omitted" notice reaches the speech provider. Human-facing prose around the blocks remains in reading order. Each new reply plays once; refreshing, opening 3D Chat, or changing threads never speaks loaded history.

Assistant prose messages expose a small accessible replay control in 3D Chat, Threads, and invocation transcripts. Replay is always explicit outside 3D Chat, so thread and invocation loads or live updates never start speech. Long replies are synthesized and played as sequential requests within the backend's 8,000-character request bound. Starting another clip stops the previous clip on that transcript surface.

The avatar nameplate includes a compact microphone button and volume icon, outside the composer. Dictation uses the same caret-aware insertion behavior as Threads mode. Voice defaults on when saved TTS settings are active. Muting stops playback immediately and stores a per-project browser preference; it does not disable the saved TTS model for other clients. If no TTS model/API is active, the volume icon is disabled and its accessible help points the operator to Settings -> AI Models.

## Model Management API

- `GET /api/speech/models` lists STT and TTS entries with installation and progress state.
- `POST /api/speech/models/:modelId/download` validates `acceptedLicenseId` and starts a background bundle download.
- `POST /api/speech/models/:modelId/cancel` cancels an in-flight download.
- `DELETE /api/speech/models/:modelId` removes the local bundle.
- `POST /api/speech/synthesis` resolves scoped settings and returns audio bytes.

Downloads use fixed upstream repositories and file manifests. Partial files use a `.part` suffix and are removed after failure. Local weights stay outside npm/Electron packages so application upgrades do not duplicate or replace user model caches.

## Related Documentation

- [Speech Input Architecture](./speech-input.md)
- [Settings Reference](../settings/index.md)
- [System Overview](./system-overview.md)
