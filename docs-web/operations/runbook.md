# Authenticated Automation Runbook

Run recovery drills only against the approved local test project and mocked job/email providers.

Run the complete offline drill with one command. It uses a temporary file-backed SQLite database, the checked-in 20-record fixture, an authenticated MCP authoring context, authenticated in-process HTTP routes, and mocked job, email, and Docker command boundaries. Generated custom-node code is validated and executed only through the custom-node container service; the test never evaluates it in the Code UX process or starts Docker.

```bash
pnpm run test:e2e:credentialed-automation
```

1. Use `manage_node_flows` with authenticated agent/conversation metadata to generate and validate the custom node and to create, patch, validate, and publish the flow. Supply credentials only through the credential broker.
2. Start pinned version 2 through `NodeFlowRuntimeService.runFlow`, interrupt an active pre-invocation node, reopen the same SQLite database, recover, and call `resumeRun`. The run id, publication id, node run, and attempt must remain unchanged.
3. Process exactly 20 mocked job records through the custom-node runtime, approve the five selected messages in sequence, and deliver them through the durable outbox.
4. Confirm five unique provider idempotency keys, each used once. Exercise provider unavailability, missing and revoked credentials, rotation, and readiness failure without live external calls.
5. Publish a rollback of version 1 as the latest publication while proving the completed run remains pinned to version 2.
6. Verify unauthenticated and unauthorized project failures, `/health` liveness, and `/ready` failure when key material is unavailable.

Record database integrity, key ids/versions (never key material), last audit id, lease/outbox counts, and rollback publication. A drill passes only with 20 processed fixtures, the expected selected delivery count, no duplicate provider/idempotency ids, and no secret canary.

The drill checks zero canary disclosure across MCP responses, graphs, attempts, invocation messages, audit export, logs, custom-node diagnostics, and run summaries. Recovery replays only pre-invocation work; externally observable attempts with unknown outcomes remain attention-required.

## Chat connector rollback drill

Use the approved local test project and placeholder identities only. Exercise bad credentials, provider outage/throttling, stale Discord reconnect state, blocked/partial legacy-secret migration, ambiguous shared-channel routing, repeated delivery retry, and cancellation with mocked provider boundaries.

For each incident, disable the new connection/binding first, preserve sanitized health/delivery evidence, correct and reverify, then enable one test route. A credential-gated skip is recorded as not run. Roll back by re-enabling the previously verified managed/custom bridge; do not delete the failed connection until pending work, leases, sessions, audit retention, and cascading history deletion have been reviewed.

The detailed steps and cleanup contract are in [Chat connector recovery](../user/troubleshooting.md#chat-connector-recovery).
