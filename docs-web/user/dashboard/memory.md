# Memory

The **Memory** page (`/memory`) manages Code UX's two-tier semantic memory system. Embedding and speech models are installed from **Settings -> AI Models**.

## The two tiers

| Tier | Scope | Lifetime |
| --- | --- | --- |
| **Short-term** | One sprint | Created during a sprint run. Promoted to long-term on completion (if eligible) or pruned. |
| **Long-term** | One project | Stable knowledge — architectural decisions, codebase landmarks, recurring constraints. |

Both tiers are vector-indexed using a locally-running embedding model (ONNX Runtime). No memory ever leaves your machine.

## Dashboard language

The Memory route follows the dashboard's active English or German locale. Page controls, map and sidebar labels, filters, search status, confirmations, validation, empty/loading/error guidance, accessible announcements, and embedding-model actions are translated. Dates, counts, strengths, percentages, sizes, and plural forms use locale-aware formatting.

Localization never rewrites persisted knowledge or backend/catalog data. Memory content, claims, evidence, tags, agent names, model IDs and descriptions, language and license metadata, URLs, filenames, and server/API diagnostics remain verbatim. German category terms such as `Architektur` can match the corresponding stable stored category key without changing that key.

## Categories

Each memory has a **category**:

- `context` — generic context (default).
- `architecture` — design decisions, architectural rules.
- `codebase` — file/symbol landmarks.
- `preferences` — formatting, naming, and style preferences.
- `patterns` — recurring implementation patterns.
- `decision` — explicit technical decisions made.
- `error` — known errors or workarounds.
- `learning` — task learnings.

Categories drive default rendering and can be used as filters in search.

## Header summary, filters, and actions

The Memory header is the main place to choose what the graph, sidebar, and inspector are showing. It is grouped into separate rows so the current state stays readable on desktop and wraps cleanly on narrow screens:

- **Tier summary tabs** — **Short Term**, **Long Term**, and **Skills** show their indexed counts directly in the tab cards.
- **Current scope line** — shows copy such as `Short Term: showing 7 memories of 17 memories · Sprint 2 · All Agents` or `Long Term: showing 1 memory of 1 memory · Project-wide · All Agents`.
- **Scope filters** — Short-term memory shows the sprint selector when sprint scope data is available, and both tiers show the agent preset selector when agent presets are available. When a source list is empty, the filter row shows reason copy instead of rendering a focusable empty selector.
- **Actions** — **Add Memory** and **Danger Delete** are separated from the selectors. Add Memory opens the manual memory dialog for the current tier scope. Danger Delete always shows Off/Armed state plus persistent explanatory copy; when armed, the page warning refers to this as Lobotomize mode because graph-node and inspector deletes become immediate. Model management lives in **Settings -> AI Models**.

The sidebar search field filters the current visible tier, sprint, and agent slice by memory text/category. Programmatic semantic search still uses vector similarity across requested scopes (cosine similarity, configurable `minSimilarity`).

Danger Delete semantics are unchanged: graph and inspector single-memory deletes are immediate only while Danger Delete is armed, while sidebar card deletion uses its separate arm/cancel guard.

## Memory Map controls

The graph canvas supports direct map navigation:

- Scroll the canvas to zoom around the pointer and drag to pan.
- Click a memory node to select it, focus the camera on that memory, and open the inspector.
- Use the **Zoom in**, **Zoom out**, and **Reset view** icon controls in the canvas. Reset returns to the overview and clears the current memory selection.
- The canvas also shows the category legend, visible node count, and a selection status chip for the currently loaded memories.

The sidebar starts collapsed so the graph remains visible. Use the sidebar toggle to open or close the memory list. When expanded, it shows search above the current alive memory list for the selected tier, sprint, and agent filter. Selecting a row opens that memory in the inspector; list controls can select all currently visible rows, clear selection, or delete selected memories after confirmation. Closing the sidebar clears the transient search and selected list rows.

Below the graph, category summary cards show alive and loaded totals for each memory category in the current result set.

### Performance

The animated neural canvas pauses rendering while the browser tab or page is hidden and resumes when it becomes visible again. The node graph, sidebar list, inspector, and category summary reflect the currently loaded memories for the active tier, sprint, agent, and search context.

## Creating a memory

Click **Add Memory**. Provide:

- **Content** — the memory body (markdown supported).
- **Category** (default `context`).
- **Scope** — `project`, `sprint`, or `agent`.
- **Strength** — initial weighting; defaults to `1.0`.
- **Sprint / agent** — required if scope is `sprint` or `agent`.

The memory is embedded immediately using the active embedding model.

## Worker capture

Worker `.task-learnings.md` files still create short-term memories from `## Category:` bullets. They may also include an optional `## Self Reflection Rating` section with `Overall: N/5` and per-section bullets such as `- Implementation: 4/5 - note`. Ratings are stored as task-run self-reflection records, separate from semantic memories, and malformed rating sections are ignored.

## Project Manager direct memory

The dashboard reply route defaults to the **Project manager**. It keeps the normal short-term and long-term context, and it also receives `add_long_term_memory`, a dedicated direct-write lane for explicit remember/learn requests and stable knowledge it judges valuable.

A successful direct write creates a canonical long-term claim plus a searchable project-memory mirror. The Project Manager then re-emits the exact returned statement, category, claim id, and mirror-memory id in a `codeux:memory` block, which the dashboard renders as a rich confirmation widget. Short-term sprint evidence and normal remediation/promotion remain unchanged.

## Editing & deleting

Sidebar memory cards use their own guarded delete flow. Graph and inspector single-memory deletion is immediate only while Danger Delete is armed.

## Promotion (short-term → long-term)

The dashboard exposes a **Promote** flow:

1. **Analyse** — Code UX scores each short-term memory by recency, recurrence, and embedding centrality.
2. **Review** — A modal presents a ranked list with an explanation per item.
3. **Execute** — Approved items are copied to the long-term scope (originals remain available until pruned).

Auto-promotion also runs as the final step of a sprint when the sprint settles successfully.

## The graph view

Select a memory from the canvas or sidebar to inspect its **embedding map** context: a 2D projection of nearby memories with edges to top-K neighbours. Useful for spotting clusters and duplicates.

The map updates after memory reloads, re-embedding, or promotion.

Rapid tier, sprint, or agent filter changes are sequenced by the Memory page data hook. Older responses are discarded, so only the newest memory list and embedding map can update the graph or clear the loading state.

The graph pauses its canvas animation loop while the browser tab is hidden and resumes when the tab is visible again. Empty or loading maps clear the canvas without running the full edge, pulse, and node drawing passes, so the page stays responsive while data changes.

## Model catalog

Open **Settings -> AI Models** for the shared compact model browser. It separates:

- **Embedding Models** — memory search models that can be downloaded, activated, deleted, and used for re-embedding.
- **Add custom model** — an accessible disclosure that keeps the advanced Hugging Face ONNX form unmounted until it is opened.
- **Speech to text models** — downloadable STT bundles with scoped activation.
- **Text to speech models** — downloadable Kokoro and Piper bundles used by 3D Chat.

The embedding catalog search matches model name, id, description, language, and license metadata. Install-state, language, and source filters can be combined, and the no-results state provides one action that restores the complete catalog.

Each embedding row shows:

- Model ID and provenance (e.g. `bge-small-en-v1.5`).
- Download status (not downloaded / downloading / ready).
- Vector dimensionality.
- Whether it is currently active.

The local embedding runtime supports both BGE-style WordPiece tokenizers and XLM-R/SentencePiece Unigram tokenizers such as `multilingual-e5-large`.

Custom in-app models can be added from Hugging Face model links after opening **Add custom model**. The form accepts either `owner/repo` identifiers or `https://huggingface.co/...` model/file URLs plus display name, ONNX model file, tokenizer files, dimension, approximate size, and language. The backend rejects other hosts and stores the normalized repo, ONNX model file path, tokenizer files, dimension, approximate size, language, and validation status. Custom entries are durable settings, so they appear beside built-in models after restart.

Custom license metadata is an operator assertion, not a Code UX license review or approval. Custom model rows label those terms as **operator asserted**, and the operator must review the upstream terms before confirming that commercial use is permitted.

Actions per model:

- **Download** — Pulls model weights to local cache.
- **Select** — Activates the model. Subsequent embed operations use it.
- **Delete** — Removes the local cache.

Custom embedding models use the same download, select, source-link, and status actions as built-ins. Deleting a custom model also removes its custom catalog definition, so it must be added again before it can be downloaded later. A custom model cannot be selected until its ONNX file and required tokenizer files are downloaded. Speech models have their own input/output activation actions and cannot be activated as memory embeddings.

### Re-embedding

Switching the active model leaves existing memories embedded with the previous model — search results across mixed dimensions are nonsensical. Click **Re-embed all** to re-vectorize the project's memories with the new model. Progress is shown live; you can leave the page and check back.

## Persistent skills

Persistent skills are reusable agent instructions, not sprint learnings. They are stored in project-owned skill storages, attached to agent presets, and kept out of the project workspace and `.code-ux/` sprint files.

Open the **Skills** tier to visualize the bounded skill catalog as a read-only graph. You can search it and filter to an agent's attached storages; memory creation, embedding-model controls, and deletion controls are intentionally unavailable in this tier. Runtime skill repositories are versioned internally and mounted read-only, while skill changes go through the management tools.

Skill markdown has frontmatter for `title`, `description`, `tags`, `appliesTo`, and `version`; the markdown body is the stored instruction content. When embeddings are available, each skill gets a compact descriptor vector plus bounded, heading-aware body chunks. Search combines the strongest matching chunk with lexical descriptor/body overlap, stays within the requested project/storage or agent attachments, skips dimension mismatches, caps candidate loading, and uses deterministic tie-breakers. If the embedding model is offline, lexical search remains available instead of returning an empty catalog.

## Stats

The footer shows aggregate memory statistics: total counts per scope/category, average strength, and the active model.

## Programmatic access

The Memory MCP tool (`manage_memory`) exposes search, list, get, create, update, delete, promote, start_reembed, get_map, count, and model_status actions, as well as durable claim actions. The dedicated `add_long_term_memory` tool writes one canonical durable memory and returns confirmation-widget data. Destructive actions require approval confirmation. See [Management actions → memory](../../developer/management-actions.md#memory).
