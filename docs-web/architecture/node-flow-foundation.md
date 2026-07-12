# Node Flow Foundation

Code UX uses one canonical Graph v2 contract across backend, MCP, runtime, and dashboard. Graphs carry `schemaVersion: 2`, versioned definitions, typed ports, credential-id bindings, bounded policies, capabilities, side effects, disabled state, flow schemas, and optional immutable publication metadata.

Validation resolves definitions, checks configuration, ports, policies, graph limits, and cycles, and rejects plaintext secrets and custom source. Only `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output` are executable.

Persisted Graph v1 records retain their original immutable version and append deterministic Graph v2. Browser migration retains its original snapshot outside executable graph JSON.
