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
| Gate settled or relevant attention resolved | `null` |

Sprint cards aggregate their task statuses and latest main-merge gate with failure-before-running-before-pending precedence. Task cards and Live subtasks call the same pure resolver, so all three surfaces interpret persisted state identically.

## Compatibility and troubleshooting

`ciStatus` is optional and nullable. No schema migration or new setting is required; the projection uses existing task, event, sprint-run, and attention tables. Malformed payload JSON is ignored safely. If a badge remains after CI settles, verify that a newer settled gate event exists and that CI repair attention is no longer `open` or `claimed`.

## Related pages

- [CI integration](./ci-integration.md)
- [Sprint engine](./sprint-engine.md)
- [Data model](./data-model.md)
