# Memory Claims and Evidence

Code UX treats short-term sprint memories as evidence, not as the durable knowledge base itself.
Post-sprint remediation promotes only durable knowledge into `memory_claims`.

## Data Model

- `memories`: raw short-term and project-scope memory records. Sprint memories are observations captured during task execution.
- `memory_claims`: canonical long-term project knowledge. Each active claim has a normalized fingerprint so exact duplicates do not accumulate.
- `memory_claim_evidence`: links one claim to the sprint memories that support, contradict, or supersede it.

Claims store confidence, durability, category, tags, source metadata, and optional path applicability. Evidence stores a weighted relation to the source memory so future remediation can reason from provenance instead of raw repeated notes.

## Promotion Flow

`MemoryPromotionService.analyzeForPromotion` builds promotion candidates from sprint memories:

- filters out low-strength and CI/check/build failure notes
- detects risky sprint-local facts such as fixtures, implementation trivia, speculation, and file-specific one-offs
- clusters semantically similar memories from the same sprint into one candidate
- scores candidates with recurrence, cross-agent agreement, category weight, and risk penalties

`promoteCandidatesAsClaims` is the production promotion path for auto-promotion and post-sprint remediation:

1. Look up an existing active claim by normalized fingerprint.
2. If it exists, add the candidate memories as evidence, raise confidence/durability from the new observation, merge tags and path applicability, and do not create another long-term memory.
3. If it does not exist, create a `memory_claims` row, link all evidence memories, and create one project-scope memory whose content is the canonical claim.
4. Trigger embedding for the project-scope claim memory so existing semantic memory search keeps working.

The project-scope memory is a compatibility and retrieval layer. The claim row is the source of durable knowledge and provenance.

## Claim-First Retrieval

Agents and dashboards can search canonical claims directly through:

```http
POST /api/projects/:projectId/memory-claims/search
Content-Type: application/json

{ "query": "service wiring", "limit": 10, "minSimilarity": 0.3 }
```

The service searches embedded project-scope claim mirror memories, then hydrates the active `memory_claims` row and evidence count. This keeps vector retrieval efficient while returning provenance-aware long-term knowledge.

## Remediation Semantics

Deterministic and AI post-sprint remediation both consume the same promotion candidates. AI mode can reject risky candidates, but selected IDs are allow-listed against deterministic candidates before any write occurs.

Long-term cleanup still operates on project-scope memories for duplicate and CI-failure cleanup. Claims are retained as durable knowledge records and can continue receiving evidence across future sprints.

## Design Constraints

- CI/check/build failures are not automatically captured into short-term memory and are excluded from promotion.
- Repeated smoke-test mechanics and fixture-specific notes are evidence of task repetition, not automatically durable knowledge.
- Promotion should create stable, reusable claims about architecture, conventions, patterns, decisions, and preferences.
- Raw implementation trivia remains in sprint memory unless a remediation step distills it into a durable claim.
