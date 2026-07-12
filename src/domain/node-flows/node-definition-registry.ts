import type { NodeDefinitionManifest } from "../../contracts/node-definition-types.js";
import type { NodeFlowPort, NodeFlowValueSchema, NodeWidgetField } from "../../contracts/node-flow-types.js";

const objectSchema = (required: string[] = [], properties: Record<string, NodeFlowValueSchema> = {}) => ({
  type: "object" as const,
  ...(required.length > 0 ? { required } : {}),
  ...(Object.keys(properties).length > 0 ? { properties } : {}),
});

const dataPort = (id: string, direction: "input" | "output", required = false): NodeFlowPort => ({
  id,
  direction,
  schema: { type: "object" },
  required,
  cardinality: direction === "input" ? "many" : "one",
});

const field = (
  id: string,
  label: string,
  type: NodeWidgetField["type"],
  required = false,
): NodeWidgetField => ({ id, label, type, required });

const manifests: NodeDefinitionManifest[] = [
  {
    type: "input", version: 1, executable: true, executionKind: "local",
    configurationSchema: objectSchema(),
    ui: { label: "Input", description: "Emits the flow input.", category: "control", widgetSchema: { fields: [] } },
    ports: [dataPort("output", "output")], credentials: [], capabilities: [], sideEffect: "none",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
  {
    type: "set_fields", version: 1, executable: true, executionKind: "local",
    configurationSchema: objectSchema([], { fields: { type: "object" }, values: { type: "object" }, replace: { type: "boolean" } }),
    ui: { label: "Set fields", description: "Adds or replaces object fields.", category: "transform", widgetSchema: { fields: [field("fields", "Fields", "json")] } },
    ports: [dataPort("input", "input"), dataPort("output", "output")], credentials: [], capabilities: [], sideEffect: "none",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
  {
    type: "template", version: 1, executable: true, executionKind: "local",
    configurationSchema: objectSchema(["template"], { template: { type: "string" }, prompt: { type: "string" }, outputKey: { type: "string" } }),
    ui: { label: "Template", description: "Renders a deterministic text template.", category: "transform", widgetSchema: { fields: [field("template", "Template", "textarea", true), field("outputKey", "Output key", "text")] } },
    ports: [dataPort("input", "input"), dataPort("output", "output")], credentials: [], capabilities: [], sideEffect: "none",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
  {
    type: "provider_prompt", version: 1, executable: true, executionKind: "provider",
    configurationSchema: objectSchema(["prompt"], { prompt: { type: "string" }, template: { type: "string" }, provider: { type: "string" } }),
    ui: { label: "Provider prompt", description: "Runs a prompt through a configured CLI provider.", category: "ai", widgetSchema: { fields: [field("prompt", "Prompt", "textarea", true), field("provider", "Provider", "text")] } },
    ports: [dataPort("input", "input"), dataPort("output", "output")],
    credentials: [{ slot: "provider", label: "Provider connection", required: false, allowedKinds: ["provider"] }],
    capabilities: ["provider.execute"], sideEffect: "external",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
  {
    type: "http_request", version: 1, executable: true, executionKind: "http",
    configurationSchema: objectSchema(["url"], { url: { type: "string" }, method: { type: "string" }, timeoutMs: { type: "number" }, headers: { type: "object" } }),
    ui: { label: "HTTP request", description: "Calls a bounded HTTP or HTTPS endpoint.", category: "integration", widgetSchema: { fields: [field("url", "URL", "text", true), field("method", "Method", "text")] } },
    ports: [dataPort("input", "input"), dataPort("output", "output")],
    credentials: [{ slot: "auth", label: "HTTP credential", required: false, allowedKinds: ["http"] }],
    capabilities: ["network.http"], sideEffect: "external",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 }, timeout: { timeoutMs: 30_000 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
  {
    type: "output", version: 1, executable: true, executionKind: "local",
    configurationSchema: objectSchema(),
    ui: { label: "Output", description: "Selects the flow result.", category: "control", widgetSchema: { fields: [] } },
    ports: [dataPort("input", "input")], credentials: [], capabilities: [], sideEffect: "none",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } }, documentation: "docs/architecture/node-flows.md#runtime",
    deprecation: { deprecated: false },
  },
];

const keyFor = (type: string, version: number): string => `${type}@${version}`;
const registry = new Map(manifests.map((manifest) => [keyFor(manifest.type, manifest.version), manifest]));

export const listNodeDefinitions = (): readonly NodeDefinitionManifest[] => manifests;

export const resolveNodeDefinition = (type: string, version: number): NodeDefinitionManifest | null => (
  registry.get(keyFor(type, version)) ?? null
);

export const resolveLatestNodeDefinition = (type: string): NodeDefinitionManifest | null => (
  manifests.filter((manifest) => manifest.type === type).sort((left, right) => right.version - left.version)[0] ?? null
);
