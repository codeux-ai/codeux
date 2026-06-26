# Knowledge

The **Knowledge** page (`/knowledge`) is a per-project knowledge base. You add documents, Code UX
chunks and embeds them, and agents can retrieve the relevant pieces during planning and coding —
giving them grounded project context without pasting it into every prompt.

## Adding documents

Add knowledge from four sources:

| Source | Use it for |
| --- | --- |
| **Upload** | Files from disk — Markdown, source files, PDFs, and Word (`.docx`) documents. |
| **Paste** | Ad-hoc notes, specs, or snippets pasted directly into a sticky-note document. |
| **Repo path** | One or more paths inside the project repository, imported as documents. |
| **Project** | Import existing knowledge from another Code UX project. |

## How documents are processed

Each document is split into chunks and embedded with the active embedding model. The card shows its
status:

- **Ready** — embedded successfully, with the number of chunks and approximate token count.
- **Error** — processing failed; hover the status for the error message.

Documents are labelled by type (PDF, Word, code, pasted note, repo path, imported) so the list stays
scannable.

## Searching

The search box runs a **semantic search** across all ready documents in the project and returns the
best-matching chunks with their source document. This is the same retrieval agents use, so it is a
quick way to sanity-check what an agent would find for a given query.

## Managing documents

- **Re-embed** a document after switching embedding models, or to reprocess a failed import.
- **Delete** a document to remove it and its chunks from the index.

Knowledge uses the embedding models managed on the [Memory](./memory.md) page. If search returns
nothing, confirm documents are **Ready** and embedded with the currently active model.

## Knowledge vs. memory

- **Knowledge** is curated reference material *you* add (docs, specs, code) for agents to retrieve.
- [Memory](./memory.md) is what the runtime *learns* automatically — short-term sprint memory and
  long-term project memory captured from completed work.

Use Knowledge for durable, authored context; rely on Memory for accumulated, run-derived learnings.
