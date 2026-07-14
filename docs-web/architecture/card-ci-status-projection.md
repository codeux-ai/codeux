# Card CI Status Projection

Task, Sprint, and Live cards expose one compact persisted `ciStatus`: `pending`, `running`, `failed`, or `null` after settlement. The projection does not load the large remote Git status snapshot and does not poll GitHub or GitLab.

## Persisted evidence

Code UX batch-loads the latest `ci_gate_status` event per task, the latest `main_merge_gate_status` event per sprint, and active `open` or `claimed` CI repair attention. Ordering uses the event timestamp and event identity so restart-style reads are deterministic.

Only the compact status crosses the card contract. Failed logs, credentials, and arbitrary attention payload fields remain internal.

## Resolution rules

| Evidence | Card status |
| --- | --- |
| Durable task `merge_indicator = CI` without usable newer detail | `pending` |
| Latest task or main-merge gate is waiting on checks | `running` |
| Failed checks, blocked task gate, or active CI repair attention | `failed` |
| Review-only main-merge blocker without failed checks | `null` |
| Gate settled or relevant attention resolved | `null` |

Sprint cards aggregate their task statuses and latest main-merge gate with failure-before-running-before-pending precedence. Task cards and Live subtasks call the same pure resolver, so all three surfaces interpret persisted state identically.

Review gating remains separate from CI failure presentation. A main-merge `review_blocked` event becomes `failed` only when it also carries failed-check evidence or matching CI repair attention is active.

The dashboard combines that evidence with lifecycle and latest-review state in one durable six-stage delivery flow on Task, Live, Sprint gallery, Sprint ledger, and Overview cards: **Coding**, **Pull request**, **QA**, **CI**, **Merge**, and **Completion**. CI evidence enriches the middle stages but is optional, so a Sprints refresh without historical gate events cannot unmount or flash away the badge. A durably completed workflow settles missing historical PR, checks, and merge projections as successful rather than showing contradictory pending stages. A newer successful observation replaces stale failure, while active matching CI attention restores the failure state.

Active, task-matched human-only attention has presentation precedence over the ordinary lifecycle and gate summary: the trigger becomes red **Human needed** while its disclosure retains all six stages. Explicit attention-item evidence is required: status is `open` or `claimed`, owner is human/user, and worker assignment is explicitly empty. Cleared, machine-owned, worker-assigned, sibling-task, and sibling-sprint attention does not. Sprint-run summaries alone never qualify because they omit status and assignment and may come from generic pause/error events.

The bright interactive badge opens one viewport-positioned interaction region without a visible outer card. Its opaque Delivery flow card contains the circular rail; a floating responsive arrow points to an independent opaque QA review card when a review exists. Requested changes use the blue pencil and **QA edits** treatment even when failed-check evidence also exists; red identifies actual provider/runtime/workflow failures and explicit **Human needed** intervention. Live replaces its separate task lifecycle and QA badges, while Task, Sprint, and Overview surfaces keep their surrounding lifecycle context and replace the standalone QA/CI disclosures. While a sprint is running, the sprint badge stays on Coding and ignores child-task gate aggregation unless active human-only intervention takes precedence; each task badge continues showing its own PR, QA, CI, and Merge transitions.

The deterministic dashboard integration suite replays these outcomes across all four card renderings, including keyboard-only QA details, collapsed follow-up specifications, Escape focus restoration, unrelated-event isolation, and unchanged snapshot replay. It mocks runtime boundaries and does not invoke Docker, provider CLIs, Git hosting, or a live database.

## Compatibility and troubleshooting

`ciStatus` is optional and nullable. No schema migration or new setting is required; the projection uses existing task, event, sprint-run, and attention tables. Malformed payload JSON is ignored safely. If a badge remains after CI settles, verify that a newer settled gate event exists and that CI repair attention is no longer `open` or `claimed`.

## Related pages

- [CI integration](./ci-integration.md)
- [Sprint engine](./sprint-engine.md)
- [Data model](./data-model.md)
