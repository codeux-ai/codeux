# Custom Node Architecture and Security

Custom nodes are project-owned TypeScript packages that pass explicit validation and publication gates before Code UX can execute them. Generated code is never imported or evaluated by the Code UX server.

## Availability

Custom execution is available only for an immutable published type/version and only while the `CODE_UX_CUSTOM_NODES_ENABLED=true` feature gate is enabled. Unpublished definitions are absent from the executable registry, and a disabled gate rejects a run before credential resolution or Docker startup. No dashboard or public management route bypasses these gates.

## Generated package and validation

Packages live at `.code-ux/nodes/<node-id>/` and include a manifest, exact package metadata, frozen pnpm lockfile, strict TypeScript configuration, typed local SDK, `src/index.ts`, an isolated runner, deterministic tests, fixtures, and a multi-stage Dockerfile.

The SDK exposes immutable input/config, correlation and invocation ids, cancellation, a redacting logger, deterministic clock, bounded HTTP and credential slots, temporary storage, and artifacts. It does not expose the project path, host environment, raw filesystem, subprocesses, Docker, or raw networking.

Validation fails closed on malformed schemas or identity, undeclared capabilities, excessive resources, symlinks, unpinned dependencies, lockfile drift, a modified trusted Docker recipe, prohibited APIs, vulnerability-audit failure, TypeScript or deterministic-test failure, fixture mismatch, output-schema failure, resource/network-policy failure, or secret-canary leakage. The exact recipe restores locked dependencies with lifecycle scripts disabled, then performs typecheck, build, and tests in a network-disabled stage. The vulnerability check is an injected governed hook; validation fails when it is not configured.

A passed revision produces an immutable content-addressed envelope with source and build digests, immutable image id, dependency inventory, validation report, creator/invocation/correlation metadata, and declared capabilities. Publication registers only its typed definition and digest. Flow graphs never embed custom source.

## Isolated execution

Published images run as non-root with a read-only root, all capabilities dropped, `no-new-privileges`, optional seccomp/AppArmor profiles, bounded CPU/memory/PIDs/time/stdout, and a size-limited no-exec tmpfs. The runtime uses `--network none` and mounts neither the project nor the Docker socket nor persistent run state.

Each invocation receives a fresh mode-`0600` stdin envelope. Credential values come only from the existing project-scoped `CredentialBroker`; they are never added to the environment, image, labels, cache keys, graph JSON, or persistent volume. The envelope and scratch state are deleted after the run.

HTTP remains fail closed unless a transport backed by the existing `EgressPolicyService` is supplied. The default runner rejects HTTP rather than enabling bridge or host networking. Any future transport must preserve the existing host/port allowlists, DNS and redirect revalidation, response-size, timeout, retry, and rate bounds.

The parent validates the output schema and recursively replaces resolved credential values in outputs, logs, traces, and diagnostics before persistence. Content-addressed image caching therefore retains immutable code only, not credentials or cross-run mutable state.

## Persistence

`custom_nodes` stores lifecycle state, `custom_node_artifacts` stores immutable artifact envelopes, and `custom_node_publications` binds a type/version to an artifact digest. The published versioned registry is the executable authority.
