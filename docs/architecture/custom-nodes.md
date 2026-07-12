# Custom Node Architecture and Security

Custom nodes are project-owned TypeScript packages that move through an explicit draft, validation, publication, and container-execution boundary. Generated code is never imported, evaluated, or executed in the Code UX process.

## Availability and gates

Custom execution is available only when both gates pass:

1. A source revision has completed validation, produced an immutable artifact, and been explicitly published.
2. `CODE_UX_CUSTOM_NODES_ENABLED=true` (or an equivalent explicitly enabled runtime dependency) is active.

An unpublished type/version is absent from the executable node-definition registry. A disabled feature gate rejects execution before credentials are resolved or Docker starts. There is no dashboard or public management route that bypasses these service gates.

## Package contract

`CustomNodeProjectService` generates `.code-ux/nodes/<node-id>/` with `node.json`, exact package metadata, a frozen pnpm lockfile, strict TypeScript configuration, `src/index.ts`, a local typed SDK, an isolated stdio runner, deterministic tests, fixtures, and a multi-stage Dockerfile. Both the Dockerfile and generated runner must remain byte-for-byte equal to their trusted generated versions during validation.

The handler receives only `NodeExecutionContext`: immutable JSON input/config, correlation and invocation ids, an abort signal, a redacting logger, a deterministic clock, bounded HTTP and credential slots, tmpfs-backed temporary storage, and artifact writing. It does not receive a project path, process environment, host filesystem handle, subprocess API, Docker handle, or raw network client.

## Validation and publication

`CustomNodeBuildService` changes a draft to `validating` and runs these fail-closed checks:

- manifest identity, value schemas, credential slots, capabilities, and resource limits
- package size, file count, symlink, exact dependency, and frozen-lockfile checks
- prohibited API scans for filesystem, environment, subprocess, Docker, raw network, worker, and alternate-runtime access
- least-privilege comparison between declared capabilities and SDK usage
- a required vulnerability-audit hook
- an exact trusted Docker recipe whose locked, script-disabled dependency restore is separate from network-disabled TypeScript, build, and deterministic-test stages
- an isolated fixture execution with CPU, memory, PID, time, output, scratch, and network bounds
- output-schema, deterministic expected-output, and secret-canary checks

Any failed check records a `failed` report and no artifact. A passed build records dependency inventory, source revision, deterministic build digest, Docker image id, validation report, creator/invocation/correlation metadata, manifest, and declared capabilities. The artifact envelope is content-addressed and immutable. Publication stores only its digest and registers a typed `custom.*@version` definition; flow graph JSON contains the definition reference and configuration, never source.

The audit hook is intentionally injected so custom nodes consume the governed dependency policy instead of creating a second vulnerability policy. With no hook, validation fails.

## Runtime boundary

`CustomNodeRuntimeService` resolves only a published artifact and launches its immutable image with:

- `--network none`, never host networking
- a non-root uid, read-only root filesystem, all Linux capabilities dropped, and `no-new-privileges`
- optional configured seccomp and AppArmor profiles
- CPU, memory/swap, PID, timeout, stdout, and tmpfs size limits from the validated manifest
- no project mount, Docker socket, host environment, persistent volume, or cross-run writable state
- a fresh stdin credential/input envelope and a fresh tmpfs scratch directory per invocation
- Docker logging disabled; bounded stdout/stderr are captured by the parent

Credential values are resolved through the existing `CredentialBroker` using the project, credential id, workspace, and required capability. They are never placed in an image layer, image label, cache key, graph, process environment, or broker configuration. The temporary stdin file is mode `0600`, removed after the invocation, and its in-memory values are cleared. Credential values and the ephemeral bridge token are exact-value redaction inputs for structured output, diagnostics, and captured logs.

For a manifest that declares `network.http`, the runtime starts a per-invocation Unix-socket broker, mounts only that socket directory read-only into the network-none container, and supplies an ephemeral authenticated bridge reference in the stdin envelope. The generated runner sends SDK requests over that socket; it cannot open Internet connections directly. A node without the capability receives no bridge reference or mount and fails closed.

Every bridged request goes through the shared `EgressPolicyService` with the manifest's host and port allowlists, HTTPS default and explicit HTTP opt-in, double DNS resolution and private-network blocking, redirect revalidation, restricted request headers, bounded content types and response size, timeout, retry, and per-project/node rate policy. The broker accepts only bounded typed messages, authenticates its random per-run token with constant-time comparison, and disappears with the run directory after execution. Policy failures are returned to the runner as errors and never enable Docker bridge or host networking.

Outputs are schema-checked before persistence. Resolved credential canaries are recursively redacted from JSON output and replaced in logs and diagnostics. Run directories are unique and deleted after each invocation, so image caching retains only immutable code and cannot retain plaintext credentials or mutable run state.

## Persistence

SQLite separates mutable lifecycle state from immutable execution authority:

- `custom_nodes` stores the current draft identity, lifecycle state, report, and selected artifact digest.
- `custom_node_artifacts` stores immutable content-addressed artifact envelopes.
- `custom_node_publications` binds one custom type/version to one artifact digest.

This mirrors node-flow publication: the versioned registry remains the executable authority, while source stays in the project package directory.
