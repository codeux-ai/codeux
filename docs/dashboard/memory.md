# Memory Architecture and Search

Sprint OS utilizes semantic embeddings to retrieve relevant project context ("memories") during tasks. This guide outlines the memory search workflow and the configuration of retrieval bounds.

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
