# Authenticated Automation Runbook

Run recovery drills only against the approved local test project and mocked job/email providers.

1. Verify a viewer can read its project and receives `403` for another project; correlate both requests in audit export.
2. Stop the key provider with encrypted rows present. `/health` stays live, `/ready` returns `503`, and a new process refuses startup.
3. Process the 20-record fixture, approve selected drafts, and restart after outbox enqueue. Sent idempotency keys must not invoke the provider twice; unknown outcomes require attention.
4. Rotate the external credential and confirm the binding resolves its next version; revoke it and confirm access is denied without secret canaries in exports, logs, prompts, traces, or diagnostics.
5. Publish a later automation, then draft/publish the earlier immutable version. Existing runs remain pinned and new runs select the rollback publication.
6. Restore SQLite/WAL plus key versions in isolation. Keep runners disabled until readiness, audit continuity, lease ownership, approvals, and outbox counts match the backup manifest.

Record database integrity, key ids/versions (never key material), last audit id, lease/outbox counts, and rollback publication. A drill passes only with 20 processed fixtures, the expected selected delivery count, no duplicate provider/idempotency ids, and no secret canary.
