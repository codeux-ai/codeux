# Memory Architecture and Search

Code UX uses semantic embeddings to retrieve relevant project context ("memories") during tasks. This guide outlines memory search, embedding provider selection, and remediation.

## Embedding Providers

Memory embeddings can run through either backend:
- `in_app`: downloaded ONNX models managed from the Memory page. The built-in catalog lives in `src/services/embedding-model-catalog.ts` and includes:
  - `all-minilm-l6-v2`
  - `all-mpnet-base-v2`
  - `bge-small-en-v1.5`
  - `bge-base-en-v1.5`
  - `bge-large-en-v1.5`
  - `multilingual-e5-large`
- `external_api`: an OpenAI-compatible embeddings endpoint configured in Settings → Memory with `baseUrl`, `apiKey`, `model`, and optional `dimensions`.

`MemoryService` resolves the effective project settings before capture, search, map generation, stale-count checks, and re-embedding. External API dimensions can be inferred from the returned vector, so models with custom vector sizes can be stored safely in `embeddingDimension`.

## Memory Search Behavior

When an agent searches for relevant memories, it submits a query. Sprint OS follows a robust multi-step retrieval process using `MemoryService.search`.

### 1. Filtering

Before computing similarity scores, candidate memories are loaded from the repository based on hard criteria to prevent over-fetching:

- **Project ID**: The base boundary for all knowledge. Cross-project reads are explicitly prevented.
- **Scope**: Memories can be filtered by their scope bounds (e.g., `project`, `sprint`, or `agent`).
- **Sprint ID**: Optionally filters to knowledge explicitly bound to a given sprint.
- **Agent Preset ID**: Optionally filters to knowledge specific to an agent persona.
- **Dimension Matching**: Ensures only embeddings created with the currently loaded Embedding Model's dimension size are selected for comparison. This prevents errors when the default embedding model is swapped.

### 2. Ranking and Scoring

Once candidates are loaded, the following steps are executed:

1. **Cosine Similarity**: The cosine similarity is computed between the query's vector and each candidate memory's vector. Candidates that fall below the caller-specified `minSimilarity` threshold (default is `0.3`) are pruned.
2. **Descending Sort**: Qualifying candidates are sorted in descending order by their similarity score so the most relevant contexts bubble to the top.
3. **Limit Output**: Results are strictly limited to the caller's requested `limit` bound (default `20`).

### 3. Hydration

To preserve memory efficiency, the core scoring and sorting operate strictly on dense vectors. The full textual payloads and metadata of the top-ranking results are subsequently hydrated using a single batch repository fetch (`MemoryRepository.getMemories(topIds)`). The service then restores the scored order, returning a list of `MemorySearchResult` objects ready to feed the agent context windows.

## Storage Requirements

Memory records encapsulate the base `content` string alongside its vectorized byte representation (`embeddingBlob`). The byte buffer must correctly decode based on its stored `embeddingDimension`. The system expects IEEE 754 32-bit floats.

## Post-Sprint Remediation

When a sprint completes, Code UX can run memory remediation according to `memory.remediationMode`:
- `off`: no post-sprint curation.
- `deterministic`: uses promotion scoring and promotes qualifying sprint memories up to `memory.remediationMaxPromotions`.
- `ai`: first builds deterministic candidates, then invokes the provider routed through the `remediation` invocation route. The AI may select which candidates to promote; if the AI invocation fails, deterministic promotion is used as a fallback.

The remediation guardrail job type is `remediation`, so runaway review loops are capped by the same guardrail system as planning, CI fix, and merge-conflict repair.

CI-failure learnings are treated specially:
- CI/check/build failures are not automatically written into short-term sprint memory from the CI merge gate or worker learnings ingestion.
- CI-looking memories that are manually captured or imported are excluded from promotion analysis even if their text would otherwise score highly.
- AI remediation records a completed `remediation` execution invocation even when no candidates are eligible for provider review, so scheduled and post-sprint remediation attempts remain visible in the invocation history.

## Long-Term Remediation

The Scheduler page can run project-scoped long-term memory remediation. Deterministic cleanup removes:
- project-scope memories tagged as CI-failure learnings
- exact duplicate project memories, keeping the strongest and most recently updated copy

AI mode routes cleanup candidates through the `remediation` invocation route before deletion.
If deterministic prefiltering finds no cleanup candidates, Code UX records a completed skipped `remediation` invocation instead of dispatching an empty provider request.

## UI Updates and Accessibility
- Added keyboard-accessible clear search functionality to `MemorySearch.tsx` (supports clearing via `Escape` and a dedicated clear button with an explicit `<kbd>Esc</kbd>` visual affordance).
- Enhanced `MemoryList.tsx` to prominently display active search result counts directly in the UI instead of relying solely on `sr-only` live regions.
- Improved memory list accessibility and reduced motion fallbacks in `MemoryList.tsx`, utilizing `useInteractionTokens` to respect OS-level reduced motion preferences.
- `MemoryFilters.tsx` implements proper tab semantics and uses clear, high-contrast danger state indicators (`bg-status-red`) for lobotomize (delete) mode to prevent accidental removals.
