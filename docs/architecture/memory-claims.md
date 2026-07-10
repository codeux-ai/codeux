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

- filters out very low-strength and CI/check/build failure notes
- detects risky sprint-local facts such as fixtures, implementation trivia, speculation, and file-specific one-offs
- clusters semantically similar memories from the same sprint into one candidate
- scores candidates with recurrence, cross-agent agreement, category weight, and risk penalties
- assigns each candidate one stable `id` for remediation selection; internal evidence IDs remain available only for claim provenance

`promoteCandidatesAsClaims` is the production promotion path for auto-promotion and post-sprint remediation:

1. Look up an existing active claim by normalized fingerprint.
2. If it exists, add the candidate memories as evidence, raise confidence/durability from the new observation, merge tags and path applicability, and do not create another long-term memory.
3. If it does not exist, create a `memory_claims` row, link all evidence memories, and create one project-scope memory whose content is the canonical claim.
4. Trigger embedding for the project-scope claim memory so existing semantic memory search keeps working.

The project-scope memory is a compatibility and retrieval layer. The claim row is the source of durable knowledge and provenance.

## Direct MCP Management

Project-manager agents can maintain durable claims through `manage_memory` without waiting for sprint remediation. The canonical MCP action schema is documented in [MCP Tools and Contracts](../mcp/tools-and-contracts.md#manage_memory-claim-actions).

Dashboard Project Manager replies also receive a dedicated `add_long_term_memory` MCP lane. It accepts one durable statement and writes through the same canonical claim + project-memory mirror path as `manage_memory.create_claim`, with `learning`, `0.9` confidence, and `0.9` durability defaults. This narrower tool is always enabled for the assigned dashboard reply agent even when that preset has an explicitly narrowed Code UX tool policy. Its response includes a `memory` rich-widget descriptor so the reply can visibly confirm exactly what was stored.

The direct lifecycle is:

1. `create_claim` requires `projectId` and a non-blank `claim`, then creates both the canonical `memory_claims` row and a project-scope mirror memory.
2. Optional `sourceMemoryId` links source evidence during creation; `supportType`, `weight`, or `evidenceWeight` can refine that relationship.
3. `update_claim` changes the canonical row and synchronizes mirror memory content, category, and strength.
4. `add_claim_evidence` links additional project-scoped evidence memory to the claim.
5. `deprecate_claim` is the destructive lifecycle action. It first returns `approvalRequired: true` and only changes state when the repeated request includes `approval.confirmed: true`.

The dedicated lane does not replace short-term memory capture. Sprint evidence continues to enter `memories`, and remediation/promotion continues to curate that evidence. `add_long_term_memory` is for explicit remember/learn requests and stable knowledge the Project Manager judges valuable across future work.

Example:

```json
{
  "action": "add_claim_evidence",
  "projectId": "project-123",
  "claimId": "claim-123",
  "memoryId": "mem-456",
  "supportType": "supports",
  "weight": 0.75
}
```

## Claim-First Retrieval

Agents and dashboards can search canonical claims directly through:

```http
POST /api/projects/:projectId/memory-claims/search
Content-Type: application/json

{ "query": "service wiring", "limit": 10, "minSimilarity": 0.3 }
```

The service searches embedded project-scope claim mirror memories, then hydrates the active `memory_claims` row and evidence count. This keeps vector retrieval efficient while returning provenance-aware long-term knowledge.

## Remediation Semantics

Deterministic and AI post-sprint remediation both consume scored promotion candidates. AI mode receives a broader review set with compact candidate IDs, score, reason, risk flags, `evidenceCount`, and cross-sprint count. It does not receive every source memory ID in the prompt. Selected IDs are allow-listed against those candidates before any write occurs.

Long-term cleanup still operates on project-scope memories for duplicate and CI-failure cleanup. Claims are retained as durable knowledge records and can continue receiving evidence across future sprints.

## Design Constraints

- CI/check/build failures are not automatically captured into short-term memory and are excluded from promotion.
- Repeated smoke-test mechanics and fixture-specific notes are evidence of task repetition, not automatically durable knowledge.
- Promotion should create stable, reusable claims about architecture, conventions, patterns, decisions, and preferences.
- Raw implementation trivia remains in sprint memory unless a remediation step distills it into a durable claim.
