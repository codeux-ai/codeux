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
- **Maximum Candidates**: To protect local runtimes from unbounded scans, a defensive maximum limit of 10,000 candidate records is applied during loading.

### 2. Ranking and Scoring

Once candidates are loaded, the following steps are executed:

1. **Cosine Similarity**: The cosine similarity is computed between the query's vector and each candidate memory's vector. Candidates that fall below the caller-specified `minSimilarity` threshold (default is `0.3`) are pruned.
2. **Bounded Top-K Selection**: Instead of sorting all qualifying candidates at the end, a bounded selection of size `limit` (default `20`) is maintained and incrementally sorted in descending order. When candidates have equal similarity scores, they are ordered deterministically by ID.

### 3. Hydration

To preserve memory efficiency, the core scoring and sorting operate strictly on dense vectors. The full textual payloads and metadata of the top-ranking results are subsequently hydrated using a single batch repository fetch (`MemoryRepository.getMemories(topIds)`). The service then restores the scored order, returning a list of `MemorySearchResult` objects ready to feed the agent context windows.

## Graph Visualization

When the UI generates visual graphs of memory items:
- If a valid memory embedding map is present, the layout and edges match the exact vectors provided by the embedding model.
- If no embedding map is present (or embeddings are still generating), a local fallback algorithm creates a deterministic layout. To preserve front-end performance on dense graphs, fallback category edges are bounded using a deterministic ring topology. Rather than computing $O(N^2)$ all-pairs edges within a category, it calculates exactly $N$ sequential edges per category, limiting memory and rendering bottlenecks.

## Map Camera Behavior

The memory map uses a pointer-centered camera so users can inspect dense graphs without losing spatial context:
- Mouse wheel zoom keeps the world point under the cursor stable as closely as possible while clamping to the configured zoom range.
- The zoom controls step through the same range as the wheel with the same short camera tween, and can reach a deep-readability zoom for dense maps.
- Selecting a node from the canvas or list recenters the camera on that memory at a readable zoom level, and Reset returns to the default overview without leaving a stale selection behind.
- Node points, category labels, and memory labels are drawn in clamped screen space so the graph positions zoom while dots and text remain readable instead of growing with the map or disappearing during deep inspection.
- Hovering a node highlights it and updates the cursor only. At higher zoom levels the canvas renders the focused label bubble for the selected memory instead of creating hover-only overlays.
- Dense maps are expected to remain navigable at 200+ memories without forcing every memory label to render at once.

## Storage Requirements

Memory records encapsulate the base `content` string alongside its vectorized byte representation (`embeddingBlob`). The byte buffer must correctly decode based on its stored `embeddingDimension`. The system expects IEEE 754 32-bit floats.

**Note:** Knowledge subscriptions validate requested document IDs in batched chunk-safe queries (validating project ownership efficiently) before applying the replace-all transaction.

Knowledge document object access is project-scoped. Document read, delete, re-embed, and project-import operations must prove the document belongs to the route or request project before returning content or mutating rows. Legacy unscoped document endpoints require an explicit `projectId` value and treat missing documents and cross-project mismatches as the same not-found response.

## Persistent Skills vs Memory

Persistent skills are reusable agent instructions, not observations learned during sprint execution. They live in project-owned `skill_storages`, are attached to agent presets through `agent_skill_storage_bindings`, and never write markdown files into the project workspace or `.code-ux/` sprint directories.

Skill markdown import uses frontmatter fields for `title`, `description`, `tags`, `appliesTo`, and `version`; the body is stored as the authoritative instruction content. Rendering a skill back to markdown reconstructs that metadata from the database and emits the stored body unchanged except for trailing whitespace normalization.

Skill search uses the same local embedding infrastructure as memory search but reads from `skill_embeddings`. Ordinary skill CRUD does not require an embedding provider: when no model is loaded, skills remain persisted and unembedded. When a provider is available, `SkillService` embeds the rendered skill markdown and stores the model id, vector dimension, chunk index, content hash, and blob. Search loads at most 10,000 candidate vectors from the requested storage set, skips candidates whose stored dimension differs from the query vector, ranks by cosine similarity, and breaks ties by skill id for deterministic top-K results.

## Long-Term Claims and Evidence

Sprint-scoped memories are treated as observations. Durable project knowledge is stored as canonical claims:

- `memory_claims` stores the distilled long-term claim, category, confidence, durability, status, tags, applicable paths, and source metadata.
- `memory_claim_evidence` links the claim to the sprint memories that support it.
- A project-scope memory is still created for every new claim so existing semantic memory search can retrieve the claim without a separate search path.

Active claims use a normalized fingerprint. If a later sprint produces the same durable claim, remediation links the new sprint memories as evidence on the existing claim instead of creating another long-term memory copy.

Internal MCP can also create and maintain durable claims directly through `manage_memory` without requiring a sprint ID. The canonical schema and required fields live in [MCP Tools and Contracts](../mcp/tools-and-contracts.md#manage_memory-claim-actions). The `create_claim` action writes the canonical claim row and a project-scoped mirror memory tagged with `source.originType = "memory_claim"` and `source.originId = <claimId>`, which lets `MemoryService.searchClaims` hydrate active claims from normal project memory search results. `update_claim` keeps those mirror memories aligned with the current claim text, category, confidence, and durability.

Project managers can use `list_claims`, `get_claim`, `update_claim`, and `add_claim_evidence` without approval. Destructive claim lifecycle actions use explicit approval: `deprecate_claim` returns `approvalRequired: true` until the caller repeats the same request with `approval.confirmed: true`, and it only reports success when the repository changes the claim status.

Example direct durable claim:

```json
{
  "action": "create_claim",
  "projectId": "project-123",
  "claim": "Keep provider routing decisions in project settings.",
  "category": "architecture",
  "confidence": 0.86,
  "durability": 0.9,
  "tags": ["providers"],
  "appliesToPaths": ["src/services"]
}
```

Claims can be audited through read-only endpoints:

```http
GET /api/projects/:projectId/memory-claims?status=active&category=patterns&limit=50
GET /api/memory-claims/:claimId/evidence
POST /api/projects/:projectId/memory-claims/search
```

See [Memory Claims and Evidence](../architecture/memory-claims.md) for the architecture contract.

## Post-Sprint Remediation

When a sprint completes, Code UX can run memory remediation according to `memory.remediationMode`:
- `off`: no post-sprint curation.
- `deterministic`: uses promotion scoring and promotes qualifying sprint evidence clusters up to `memory.remediationMaxPromotions`.
- `ai`: first builds promotion candidates, then invokes the provider routed through the `remediation` invocation route. The AI may select which compact candidate IDs to promote; if the AI invocation fails, deterministic claim promotion is used as a fallback.

The remediation guardrail job type is `remediation`, so runaway review loops are capped by the same guardrail system as planning, CI fix, and merge-conflict repair.

Promotion analysis treats short-term sprint memories as evidence, not as durable knowledge by default:
- sprint memories below strength `0.45` are ignored
- semantically similar memories from the same sprint are clustered into one promotion candidate with one selectable `id` plus `evidenceCount`; full source evidence IDs stay internal for claim provenance
- recurrence across previous sprints and agreement across agents can raise the candidate score
- near-duplicates of existing project-scope memories are skipped
- risk flags such as `test_fixture`, `task_local`, `file_specific`, `implementation_trivia`, `speculative`, and `ci_failure` reduce the score before the promotion threshold is applied
- the default promotion threshold is `0.5`; AI remediation uses a lower review floor of `0.45` so the model has a useful candidate set to curate without automatically promoting every reviewed memory
- AI remediation receives the cluster claim, score, reason, risk flags, evidence count, and cross-sprint count so repeated smoke-test or fixture mechanics are visible as risky evidence rather than durable project knowledge
- selected candidates become long-term claims with evidence links; raw sprint notes are not copied verbatim unless the claim itself is already the durable statement

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

The Memory settings panel also manages one project-scoped scheduler entry for long-term remediation. Users can set it to Off, Every day, or Every week without leaving Settings. Entries created this way are marked as `memoryRemediationTarget.source = "memory_settings"` so manually created Scheduler page entries are not overwritten.

## UI Updates and Accessibility
- The Memory page model catalog is presented as a Warm Void panel with a state summary and responsive model cards. It distinguishes active, downloaded, downloading, stale, and unavailable models without using legacy violet action styling.
- Model catalog primary actions use Signal Jade for download and activation, stale re-embedding warnings use Ember, and destructive/error states use status red. The downloaded-model delete action is icon-only with an accessible label and is disabled while the model is active.
- The memory sidebar now starts collapsed by default and exposes a compact rail/tab so the graph canvas remains visible until the user explicitly expands it.
- Expanding the sidebar opens directly to the current alive memory list for the selected tier, sprint, and agent filter set, with an embedded search input above the list. Browsing all visible memories is still the default path; search is not required before the list is useful.
- Closing the sidebar clears the current search query and selected memory IDs so returning to the sidebar starts from the current visible memory list.
- `MemorySearch.tsx` provides debounced text filtering by memory text/category and keyboard-accessible clear behavior (supports clearing via `Escape` and a dedicated clear button with an explicit `<kbd>Esc</kbd>` visual affordance). Search exposes a visible typing/pending state while the debounced query is applying and uses a polite live region only for committed or cleared search changes instead of announcing every keystroke.
- Search and filter controls use `controlFeedback` for focus/pressed states, `selectionMovement` for tier movement, `inlineValidation` for danger/delete-state copy, and `asyncFeedback` for pending search status. If reduced motion resolves token durations to `0ms`, the visible pending text, selected tab state, result count, and live-region announcement remain the source of truth.
- Enhanced `MemoryList.tsx` to prominently display visible memory counts and active search text directly in the UI instead of relying solely on `sr-only` live regions, while keeping the list layout `min-w-0` and overflow-safe on narrow screens. Empty filtered results keep the `memory-panel` target available for tab/search controls and announce that no memories match the current search or filters.
- Added per-memory selection toggles and a batch action bar to the sidebar list so users can select visible memories, clear the selection, or select all currently rendered results without touching hidden records. The select-all control states the current visible scope, and batch delete copy includes the selected count and visible scope.
- Batch deletion requires an explicit confirmation dialog for every selected-delete request, including one selected memory. The delete flow is optimistic, restores any failed deletions, and reports partial failures through the memory feedback region with a retry action.
- Lobotomize mode is immediate by design for graph nodes and the inspector delete action: a single graph click deletes through the canvas deletion animation, and the inspector delete button does not open a confirmation dialog. Sidebar card deletion is less easy to trigger: each card shows persistent danger copy, must be armed first, exposes a cancel action, and only then calls the existing optimistic removal path with undo feedback.
- Selection is pruned automatically when search, tier, sprint, agent, or sidebar state changes make a memory invisible, which keeps batch actions scoped to the current visible slice of memory.
- Improved memory list accessibility and reduced motion fallbacks in `MemoryList.tsx`, utilizing `useInteractionTokens` to respect OS-level reduced motion preferences.
- Updated the memory map camera so wheel, button, and click focus interactions preserve readable navigation on dense graphs. Wheel zoom uses smoother proportional movement, and graph labels keep stable on-screen sizing during zoom so text remains readable while node positions scale.
- `MemoryFilters.tsx` implements proper tab semantics, count text, roving keyboard focus, selected sprint/agent feedback, and model-catalog pressed-state copy. The header now presents Short Term and Long Term as count summary cards, follows with a compact current-scope line such as `Short Term: showing 7 memories of 17 memories · Sprint 2 · All Agents`, and separates selectors from Add Memory, Model Catalog, and Danger Delete actions.
- Tier, sprint, agent, model catalog, and danger delete controls now expose the current selected or pressed state with visible status text and polite announcements. Disabled sprint and agent filters stay visible with reason copy instead of disappearing when no options are available, Model Catalog shows the active-model status, and the grouped header layout uses `min-w-0`, wrapping, and stable flex bases to avoid horizontal overflow.
- The memory list uses the shared `listReveal`, `listReorder`, and `expansionCollapse` motion tokens for search/filter transitions. Reduced-motion users receive immediate list updates while visible result counts and live regions continue to communicate what changed.
- Graph and list selection state is mirrored in text: selected cards show an `Open` badge, the graph area includes a visible selection status, and the inspector announces when a selected memory is open. This keeps critical selection feedback available without depending on canvas animation alone.
- During background refresh or failed refreshes, the sidebar keeps the last useful memory result list visible when available, marks the region busy or stale with visible copy, and exposes retry or next-action controls instead of replacing the list with a blank panel. Stale content is only reused for the same committed search query, so a new no-match search shows the no-match recovery state rather than old matches.
- Background refresh, retry, and stale-data states use `aria-busy` on the list region, polite refreshing copy, and assertive retryable error copy while preserving the previous useful rows only when the committed query, tier, sprint, and agent filter context still match. A newly committed search or filter with no matches must render the real no-match empty state and must not reuse stale rows from another query or scope.
- The inspector stays recoverable when a previously selected memory falls out of the current result set. It opens a visible unavailable-state panel with close guidance rather than silently disappearing.
- Memory card selection, batch selection, graph selection, and inspector reveals do not rely on hover or animation. Cards expose keyboard-reachable Open and Select controls, visible Open/Selected badges, `aria-selected`, and stable inspector status copy; the inspector uses tokenized reveal/progress styling but remains fully readable when motion is disabled.
- Adding a manual memory uses explicit form validation and async feedback: invalid submits focus the content field, pending submits mark the dialog busy, failures remain in an assertive status region, and successful creates briefly confirm before restoring focus to the opener.
- Embedding model actions now surface pending, success, and error messages from the catalog so downloads, activation, deletion, and re-embedding changes are announced without relying on model-card state changes alone. Model cards keep stable action/status slots, show text progress next to progress bars, expose disabled reasons for active/download/re-embed conflicts, suppress duplicate activations while an async action is pending, and confirm local model deletion before removal. Re-embedding progress includes both completed/total text and a progressbar so `0ms` motion still communicates progress.
- Batch deletion shows selected-count and visible-scope copy, requires confirmation that names the active tier, sprint/agent scope, and committed search, marks the list busy, disables conflicting batch controls while deletion is pending, and restores focus to the list controls after the async mutation settles or the confirmation is canceled. Mutation errors remain in the feedback region with a retry action, and duplicate refresh or mutation retries are suppressed while a retry is pending.
- Danger delete mode uses explicit armed/off copy at the filter toggle, page warning, card delete controls, and inspector delete action. Graph and inspector single-memory deletes remain immediate in this mode, while sidebar cards use an arm/cancel step before deletion.
