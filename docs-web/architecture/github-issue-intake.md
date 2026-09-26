# GitHub Issue Intake

GitHub issue intake is a deterministic node-flow built-in that turns explicitly allowed issues into bounded Code UX sprints. It reuses the existing GitHub issue search, planning, sprint orchestration, node-flow publication, and scheduler paths. It does not add a webhook listener, queue service, or model-based classifier.

## Admission contract

The `github_issue_intake` node requires a repository, at least one allow label, and a policy version. Each observation is identified by project, provider, host, repository, issue number, issue `updatedAt`, action class, and policy version. A unique SQLite record is claimed before a sprint is created, and sprint creation plus ledger linking is one transaction, so replaying an unchanged poll or restarting the runtime cannot dispatch the same observation twice or strand an unlinked sprint.

The requested repository must exactly match the selected GitHub-backed project's configured repository. Authentication continues through that project's existing GitHub integration; node input cannot select another repository or credential.

Admission is fail-closed:

- required labels are an explicit allow gate;
- excluded labels and missing immutable observation timestamps become `held`;
- unchanged, previously claimed, or previously dispatched observations are skipped without planning;
- capacity is limited to one or two active intake lanes per repository and capacity plus claim are committed in one SQLite transaction;
- a planning failure cancels the newly created sprint, records the original error, and is terminal for that exact observation until the GitHub issue changes.

The node ignores free-form search text, verifies each returned issue URL is on the exact configured GitHub repository, and reports searched, admitted, held, skipped, and failed counts plus created sprint IDs. It never includes credentials. Repository identity is canonicalized before capacity accounting. The planner enforces the one-task cap before persisting or starting work. Cancellation is honored through planning and immediately before orchestration accepts the start; after that durable handoff, the sprint run proceeds independently of the node-flow's cancellation signal.

## Persistence and recovery

`github_intake_items` is the durable claim and disposition ledger. `seen` rows may be claimed once with a conditional SQLite update. `claimed` and `dispatched` rows count against repository capacity. Terminal states are `completed`, `failed`, `held`, and `ignored`.

The claim transaction ends before planning or provider work begins. Sprint creation and ledger linking share one DB transaction. A normal planning failure cancels that sprint. A process crash cannot create a duplicate sprint from the same observed version: after the recovery window, a claim with no sprint is held, while a dispatched sprint that never left `idle` is cancelled and held for inspection. Neither case is silently retried or allowed to occupy repository capacity forever.

## Scheduling

Publish a project-owned flow containing `github_issue_intake`, then schedule that flow with the existing recurring node-flow scheduler. A conservative first deployment uses:

- required label `codeux:ready`;
- a project-specific excluded-label list for protected, fixture, calibration, or adversarial work;
- one active lane per repository until the repository is stable;
- a bounded poll result limit;
- a new policy version whenever admission rules materially change.

Polling may read GitHub on every scheduled occurrence, but an unchanged observation performs no Code UX write after the replay-safe ledger upsert and makes no model or provider call.

## Current boundary

This first slice admits GitHub issues only. Pull-request repair intake, automatic merging, branch-protection changes, issue closure, and semantic classification are not part of this node. Those capabilities must not be inferred from a successful issue-intake run.
