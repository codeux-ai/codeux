# Memory

The **Memory** page (`/memory`) manages Code UX's two-tier semantic memory system and the embedding models that power it.

## The two tiers

| Tier | Scope | Lifetime |
| --- | --- | --- |
| **Short-term** | One sprint | Created during a sprint run. Promoted to long-term on completion (if eligible) or pruned. |
| **Long-term** | One project | Stable knowledge — architectural decisions, codebase landmarks, recurring constraints. |

Both tiers are vector-indexed using a locally-running embedding model (ONNX Runtime). No memory ever leaves your machine.

## Categories

Each memory has a **category**:

- `context` — generic context (default).
- `architecture` — design decisions, patterns.
- `codebase` — file/symbol landmarks.
- `convention` — coding standards.
- `gotcha` — known issue, workaround.
- `feedback` — user-validated patterns.
- *(extensible)*

Categories drive default rendering and can be used as filters in search.

## Filters and tabs

The page splits into:

- **Short-term** tab — memories scoped to a specific sprint.
- **Long-term** tab — project-wide memories.
- **Search** — vector similarity search across both tiers (cosine similarity, configurable `minSimilarity`).

Filter bar:

- **Category** (multi-select).
- **Sprint** (short-term only).
- **Agent preset** (only memories scoped to that preset).
- **Strength range** — filter by promotion strength score (0.0 – 1.0+).

## Creating a memory

Click **+ New memory**. Provide:

- **Content** — the memory body (markdown supported).
- **Category** (default `context`).
- **Scope** — `project`, `sprint`, or `agent`.
- **Strength** — initial weighting; defaults to `1.0`.
- **Sprint / agent** — required if scope is `sprint` or `agent`.

The memory is embedded immediately using the active embedding model.

## Editing & deleting

Each memory card has **Edit** (content, category, strength) and **Delete**. Deletion requires confirmation.

## Promotion (short-term → long-term)

The dashboard exposes a **Promote** flow:

1. **Analyse** — Code UX scores each short-term memory by recency, recurrence, and embedding centrality.
2. **Review** — A modal presents a ranked list with an explanation per item.
3. **Execute** — Approved items are copied to the long-term scope (originals remain available until pruned).

Auto-promotion also runs as the final step of a sprint when the sprint settles successfully.

## The graph view

Open a memory and click **Inspect** to see its **embedding map**: a 2D projection of nearby memories with edges to top-K neighbours. Useful for spotting clusters and duplicates.

You can rebuild the map after re-embedding or after promotion.

## Embedding models

The right sidebar lists available embedding models. Each card shows:

- Model ID and provenance (e.g. `bge-small-en-v1.5`).
- Download status (not downloaded / downloading / ready).
- Vector dimensionality.
- Whether it is currently active.

The local embedding runtime supports both BGE-style WordPiece tokenizers and XLM-R/SentencePiece Unigram tokenizers such as `multilingual-e5-large`.

Actions per model:

- **Download** — Pulls model weights to local cache.
- **Cancel download** — Aborts an in-flight download.
- **Select** — Activates the model. Subsequent embed operations use it.
- **Delete** — Removes the local cache.

### Re-embedding

Switching the active model leaves existing memories embedded with the previous model — search results across mixed dimensions are nonsensical. Click **Re-embed all** to re-vectorize the project's memories with the new model. Progress is shown live; you can leave the page and check back.

## Stats

The footer shows aggregate memory statistics: total counts per scope/category, average strength, and the active model.

## Programmatic access

The Memory MCP domain (`manage_code_ux` → `domain: "memory"`) exposes search, list, get, create, update, delete, promote, start_reembed, get_map, count, and model_status actions. See [Management actions → memory](../../developer/management-actions.md#memory).
