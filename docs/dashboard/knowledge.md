# Knowledge Dashboard

The Knowledge route is the project-level surface for browsing embedded documents and checking retrieval behavior before agents use it through `search_knowledge`.

## Visual Contract

- The page header identifies the route as the shared knowledge base and summarizes document count, ready count, and embedded chunk count when documents exist.
- Primary ingestion actions stay in the header: Upload, Paste, From repo, and From project.
- The retrieval browser appears only when at least one document is ready. It uses a search input, a scope selector for whole-library or agent-subscribed documents, and result cards with document title, optional heading, similarity, snippet, and chunk metadata.
- Document cards use source-aware icons and labels, strong titles, monospace source references, summaries, ready/error/processing status pills, size and token metadata, creation dates, and subscribed-agent chips.
- Empty, loading, and search-miss states use the shared `EmptyState` and feedback styling. They avoid dashed placeholder treatments and keep the page aligned with adjacent Memory and Search surfaces while remaining focused on retrieval and browsing.

## Accessibility Contract

- The passage search input is labeled `Search knowledge passages`.
- The retrieval scope selector is labeled `Knowledge search scope`.
- Search results are exposed as a named list: `Knowledge search results`.
- Document cards are exposed as list items with the document title, source type, and processing status in their accessible label.
- Destructive and retry actions include document-specific accessible names.
- Keyboard users can submit retrieval search with Enter from the input or by activating the Search button.

## Behavior Boundaries

The dashboard route is presentation-only for retrieval semantics. It must not change knowledge API endpoints, ranking, persistence, document contracts, or subscription behavior. Changes to search ranking or ingestion belong in the backend knowledge service and API contract documentation.
