# Agent Knowledge Base

The agent knowledge base is a project-scoped document library used to ground agent presets. Documents are ingested once, embedded with the active local embedding model, and then attached to individual agents through subscriptions.

## Runtime Flow

The dashboard exposes the library under `/knowledge` and agent subscriptions inside each agent editor.
Agent editors provide search plus Select all and Unselect all controls for the visible knowledge list.

Supported ingest paths:

- Upload one or more files through `POST /api/projects/:projectId/knowledge/documents/upload`.
- Paste a note through `POST /api/projects/:projectId/knowledge/documents` with `title` and `text`.
- Ingest an in-repo file or directory through `POST /api/projects/:projectId/knowledge/documents` with `path`.
- Import selected documents from another project through `POST /api/projects/:projectId/knowledge/documents/import-project` with `sourceProjectId` and optional `documentIds`.

Repo-path ingestion resolves `path` inside the selected project's `baseDir`, rejects traversal outside the project directory, and skips common generated or dependency directories when walking a directory.

Project imports copy extracted document text into the target project as `sourceType: "project"` documents. The target project embeds the copied documents with the active embedding model and still deduplicates by content hash inside that project.

## Code UX Internal Docs

Every project can receive a grouped Code UX internal documentation entry:

- title: `codeux/internaldocs`
- source reference: `codeux/internaldocs`
- content: all markdown files under the running Code UX checkout's `docs/` directory, grouped into one knowledge document

When the built-in `Project manager` preset is first synced for a project, Code UX selects `codeux/internaldocs` for that preset by default. This seed is one-time only. If a user unselects the document later, subsequent agent syncs do not reselect it.

The repository includes precomputed BGE Small embeddings for the grouped docs at:

```text
.code-ux/embeddings/codeux-internaldocs.bge-small-en-v1.5.json
```

If the active model and bundled content hash match, Code UX loads these chunks directly instead of recomputing embeddings. If no matching bundle is available, normal asynchronous embedding is used.

## Agent Subscriptions

Agent subscriptions are persisted through:

```http
PUT /api/agent-presets/:agentPresetId/knowledge/subscriptions
Content-Type: application/json

{ "documentIds": ["..."] }
```

The server validates the agent preset and stores only documents that belong to the agent's project. The response echoes the persisted set:

```json
{ "documentIds": ["..."] }
```

At runtime, subscribed ready documents are rendered into the agent manifest. The manifest instructs the agent to call `search_knowledge` for exact passages before using attached documents.

The dashboard writes subscription changes immediately so knowledge selection is not lost if the
editor closes. Those changes also mark the agent editor dirty, enabling Save Agent as an explicit
acknowledgement step after selecting or deselecting knowledge.

## Route Registration

Knowledge and memory routes must be registered through the dashboard route-registration phase, after `applyDashboardPreRouteMiddleware` installs `express.json`. If knowledge routes are mounted before the JSON parser, pasted notes and repo-path ingest requests arrive with an empty `req.body`, and subscription updates can silently replace the agent document set with an empty array.

Focused coverage lives in `tests/backend/server/knowledge-route-registration.test.ts`.
