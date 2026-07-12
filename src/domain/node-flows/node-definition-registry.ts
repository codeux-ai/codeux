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

const builtin = (input: {
  type: string; label: string; description: string; category: string;
  properties?: Record<string, NodeFlowValueSchema>; fields?: NodeWidgetField[];
  ports?: NodeFlowPort[]; sideEffect?: NodeDefinitionManifest["sideEffect"];
  capabilities?: string[];
}): NodeDefinitionManifest => ({
  type: input.type,
  version: 1,
  executable: true,
  executionKind: "local",
  configurationSchema: objectSchema([], input.properties),
  ui: { label: input.label, description: input.description, category: input.category, widgetSchema: { fields: input.fields ?? [] } },
  ports: input.ports ?? [dataPort("input", "input"), dataPort("output", "output")],
  credentials: [],
  capabilities: input.capabilities ?? [],
  sideEffect: input.sideEffect ?? "none",
  defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 } },
  documentation: "docs/architecture/node-flow-builtins-and-security.md",
  deprecation: { deprecated: false },
});

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
  builtin({ type: "condition", label: "Condition", description: "Selects one explicit boolean branch.", category: "control",
    properties: { path: { type: "string" }, operator: { type: "string" }, value: { type: "any" } },
    fields: [field("path", "Value path", "text"), field("operator", "Operator", "select")],
    ports: [dataPort("input", "input"), dataPort("true", "output"), dataPort("false", "output")] }),
  builtin({ type: "switch", label: "Switch", description: "Selects one named case or the default branch.", category: "control",
    properties: { path: { type: "string" }, cases: { type: "array", items: { type: "object" } } },
    fields: [field("path", "Value path", "text"), field("cases", "Cases", "json")],
    ports: [dataPort("input", "input"), { ...dataPort("case", "output"), cardinality: "many" }, dataPort("default", "output")] }),
  builtin({ type: "foreach", label: "Foreach", description: "Emits a bounded list for deterministic fan-out.", category: "control",
    properties: { path: { type: "string" }, maxItems: { type: "number" }, concurrency: { type: "number" } }, fields: [field("path", "Items path", "text"), field("maxItems", "Maximum items", "number"), field("concurrency", "Concurrency", "number")],
    ports: [dataPort("input", "input"), { ...dataPort("items", "output"), schema: { type: "array", items: { type: "any" } } }, dataPort("empty", "output")] }),
  builtin({ type: "merge", label: "Merge", description: "Combines upstream values with an explicit strategy.", category: "transform",
    properties: { strategy: { type: "string" } }, fields: [field("strategy", "Strategy", "select")],
    ports: [{ ...dataPort("input", "input"), cardinality: "many" }, dataPort("output", "output")] }),
  builtin({ type: "delay", label: "Delay", description: "Waits for a bounded duration with cancellation.", category: "control",
    properties: { delayMs: { type: "number" } }, fields: [field("delayMs", "Delay (ms)", "number", true)] }),
  builtin({ type: "approval", label: "Approval", description: "Persists an operator decision gate.", category: "control",
    properties: { summary: { type: "string" }, logicalItem: { type: "string" } }, fields: [field("summary", "Summary", "textarea")],
    ports: [dataPort("input", "input"), dataPort("approved", "output"), dataPort("rejected", "output")], sideEffect: "write" }),
  builtin({ type: "email_draft", label: "Email Draft", description: "Creates an email draft without sending it.", category: "integration",
    properties: { to: { type: "any" }, subject: { type: "string" }, body: { type: "string" } },
    fields: [field("to", "To", "text", true), field("subject", "Subject", "text", true), field("body", "Body", "textarea", true)] }),
  builtin({ type: "email_send", label: "Email Send", description: "Sends an approved email through the idempotent outbox.", category: "integration",
    properties: { to: { type: "any" }, subject: { type: "string" }, body: { type: "string" }, logicalItem: { type: "string" } },
    fields: [field("to", "To", "text", true), field("subject", "Subject", "text", true), field("body", "Body", "textarea", true)],
    sideEffect: "external", capabilities: ["email.send"] }),
  builtin({ type: "execute_subflow", label: "Execute Subflow", description: "Executes a project-owned published flow.", category: "control",
    properties: { flowId: { type: "string" }, input: { type: "object" } }, fields: [field("flowId", "Flow ID", "text", true), field("input", "Input", "json")] }),
  builtin({ type: "webhook_trigger", label: "Webhook Trigger", description: "Emits authenticated webhook input.", category: "trigger",
    ports: [dataPort("output", "output")], capabilities: ["webhook.receive"] }),
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

export const listNodeDefinitions = (): readonly NodeDefinitionManifest[] => [...manifests];

export const resolveNodeDefinition = (type: string, version: number): NodeDefinitionManifest | null => (
  registry.get(keyFor(type, version)) ?? null
);

export const resolveLatestNodeDefinition = (type: string): NodeDefinitionManifest | null => (
  manifests.filter((manifest) => manifest.type === type).sort((left, right) => right.version - left.version)[0] ?? null
);

export const registerCustomNodeDefinition = (manifest: NodeDefinitionManifest): void => {
  if (manifest.executionKind !== "custom" || !manifest.type.startsWith("custom.") || manifest.executable !== true) {
    throw new Error("Only executable custom node definitions can be registered dynamically.");
  }
  const key = keyFor(manifest.type, manifest.version);
  const existing = registry.get(key);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error(`Node definition is immutable once registered: ${key}.`);
    return;
  }
  registry.set(key, manifest);
  manifests.push(manifest);
};
