import { ValidationError } from "../../../repositories/repository-utils.js";
import type { NodeFlowJsonObject, NodeFlowJsonValue } from "../../../contracts/node-flow-types.js";
import type { ApprovalService } from "../approval-service.js";
import { UnknownSideEffectOutcomeError, type OutboxService } from "../outbox-service.js";

export const MAX_FOREACH_ITEMS = 1_000;
export const MAX_SUBFLOW_DEPTH = 8;
export const MAX_DELAY_MS = 60 * 60_000;

export interface BuiltinExecutionContext {
  projectId: string; flowId: string; publicationId: string; runId: string; nodeId: string;
  config: NodeFlowJsonObject; upstream: NodeFlowJsonObject; flowInput: NodeFlowJsonObject;
  signal?: AbortSignal; subflowDepth: number;
  redactJson?: (value: NodeFlowJsonObject) => NodeFlowJsonObject;
  redactText?: (value: string) => string;
}
export interface BuiltinExecutionResult { output: NodeFlowJsonObject; selectedPorts?: string[] }
export interface BuiltinExecutorDependencies {
  approvalService?: ApprovalService;
  outboxService?: OutboxService;
  executeSubflow?: (input: { projectId: string; flowId: string; input: NodeFlowJsonObject; depth: number; signal?: AbortSignal }) => Promise<NodeFlowJsonObject>;
}

export class BuiltinExecutors {
  constructor(private readonly deps: BuiltinExecutorDependencies = {}) {}

  async execute(type: string, context: BuiltinExecutionContext): Promise<BuiltinExecutionResult> {
    switch (type) {
      case "condition": return executeCondition(context);
      case "switch": return executeSwitch(context);
      case "foreach": return executeForeach(context);
      case "merge": return executeMerge(context);
      case "delay": return executeDelay(context);
      case "approval": return this.executeApproval(context);
      case "email_draft": return executeEmailDraft(context);
      case "email_send": return this.executeEmailSend(context);
      case "execute_subflow": return this.executeSubflow(context);
      case "webhook_trigger": return { output: { ...context.flowInput } };
      default: throw new ValidationError(`Unsupported built-in node type: ${type}.`);
    }
  }

  private executeApproval(context: BuiltinExecutionContext): BuiltinExecutionResult {
    if (!this.deps.approvalService) throw new ValidationError("Approval service is not configured.");
    const approval = this.deps.approvalService.requireApproval({ projectId: context.projectId, flowId: context.flowId,
      runId: context.runId, nodeId: context.nodeId, logicalItem: readString(context.config.logicalItem) ?? "default",
      request: { summary: readString(context.config.summary) ?? "Approval required", payload: context.upstream } });
    return { output: { approved: true, approvalId: approval.id, ...context.upstream }, selectedPorts: ["approved"] };
  }

  private async executeEmailSend(context: BuiltinExecutionContext): Promise<BuiltinExecutionResult> {
    if (!this.deps.approvalService || !this.deps.outboxService) throw new ValidationError("Email side-effect services are not configured.");
    const rawDraft = buildEmail(context);
    const draft = context.redactJson?.(rawDraft) ?? rawDraft;
    const logicalItem = readString(context.config.logicalItem) ?? "default";
    this.deps.approvalService.requireApproval({ projectId: context.projectId, flowId: context.flowId, runId: context.runId,
      nodeId: context.nodeId, logicalItem, request: { effectType: "email", draft } });
    const sent = await this.deps.outboxService.dispatch({ projectId: context.projectId, flowId: context.flowId,
      publicationId: context.publicationId, runId: context.runId, nodeId: context.nodeId, logicalItem,
      effectType: "email", payload: draft });
    if (sent.status === "attention_required") throw new UnknownSideEffectOutcomeError(context.redactText?.(sent.lastError ?? "Email provider outcome is unknown.") ?? sent.lastError ?? "Email provider outcome is unknown.");
    if (sent.status !== "sent") throw new Error(context.redactText?.(sent.lastError ?? "Email send failed.") ?? sent.lastError ?? "Email send failed.");
    return { output: context.redactJson?.({ sent: true, outboxId: sent.id, providerMessageId: sent.providerMessageId }) ?? { sent: true, outboxId: sent.id, providerMessageId: sent.providerMessageId } };
  }

  private async executeSubflow(context: BuiltinExecutionContext): Promise<BuiltinExecutionResult> {
    const flowId = readString(context.config.flowId);
    if (!flowId) throw new ValidationError("Execute Subflow requires flowId.");
    if (flowId === context.flowId) throw new ValidationError("A node flow cannot directly execute itself.");
    if (context.subflowDepth >= MAX_SUBFLOW_DEPTH) throw new ValidationError(`Subflow depth exceeds ${MAX_SUBFLOW_DEPTH}.`);
    if (!this.deps.executeSubflow) throw new ValidationError("Subflow execution is not configured.");
    const output = await this.deps.executeSubflow({ projectId: context.projectId, flowId,
      input: readObject(context.config.input) ?? context.upstream, depth: context.subflowDepth + 1, signal: context.signal });
    return { output: context.redactJson?.(output) ?? output };
  }
}

function executeCondition(context: BuiltinExecutionContext): BuiltinExecutionResult {
  const actual = readPath({ input: context.flowInput, upstream: context.upstream }, readString(context.config.path) ?? "upstream");
  const expected = context.config.value;
  const operator = readString(context.config.operator) ?? "truthy";
  const matched = compare(actual, expected, operator);
  return { output: { matched, value: toJson(actual) }, selectedPorts: [matched ? "true" : "false"] };
}

function executeSwitch(context: BuiltinExecutionContext): BuiltinExecutionResult {
  const actual = readPath({ input: context.flowInput, upstream: context.upstream }, readString(context.config.path) ?? "upstream");
  const cases = Array.isArray(context.config.cases) ? context.config.cases : [];
  if (cases.length > 100) throw new ValidationError("Switch cases are limited to 100.");
  const selected = cases.find((entry) => {
    const item = readObject(entry); return item && compare(actual, item.value, readString(item.operator) ?? "equals");
  });
  const selectedCase = selected ? readString(readObject(selected)?.port) ?? readString(readObject(selected)?.id) ?? "default" : "default";
  return { output: { value: toJson(actual), selectedCase }, selectedPorts: [selectedCase] };
}

function executeForeach(context: BuiltinExecutionContext): BuiltinExecutionResult {
  const path = readString(context.config.path) ?? "upstream.items";
  const value = readPath({ input: context.flowInput, upstream: context.upstream }, path);
  if (!Array.isArray(value)) throw new ValidationError("Foreach input must resolve to an array.");
  const configured = Number(context.config.maxItems ?? MAX_FOREACH_ITEMS);
  const maxItems = Math.max(1, Math.min(MAX_FOREACH_ITEMS, Number.isFinite(configured) ? Math.floor(configured) : MAX_FOREACH_ITEMS));
  if (value.length > maxItems) throw new ValidationError(`Foreach input exceeds the bounded item limit of ${maxItems}.`);
  return { output: { items: value.map(toJson), count: value.length }, selectedPorts: value.length ? ["items"] : ["empty"] };
}

function executeMerge(context: BuiltinExecutionContext): BuiltinExecutionResult {
  const strategy = readString(context.config.strategy) ?? "object";
  const values = Object.values(context.upstream);
  if (strategy === "array") return { output: { items: values } };
  if (strategy === "first") return { output: readObject(values[0]) ?? { value: toJson(values[0]) } };
  if (strategy === "object") return { output: Object.assign({}, ...values.filter((value) => readObject(value))) as NodeFlowJsonObject };
  throw new ValidationError(`Unsupported merge strategy: ${strategy}.`);
}

async function executeDelay(context: BuiltinExecutionContext): Promise<BuiltinExecutionResult> {
  const parsed = Number(context.config.delayMs ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DELAY_MS) throw new ValidationError(`Delay must be between 0 and ${MAX_DELAY_MS}ms.`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, Math.floor(parsed));
    context.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(context.signal?.reason ?? new Error("Delay cancelled.")); }, { once: true });
  });
  return { output: { ...context.upstream, delayedMs: Math.floor(parsed) } };
}

function executeEmailDraft(context: BuiltinExecutionContext): BuiltinExecutionResult { return { output: { draft: buildEmail(context), sent: false } }; }
function buildEmail(context: BuiltinExecutionContext): NodeFlowJsonObject {
  const to = context.config.to; const subject = readString(context.config.subject); const body = readString(context.config.body);
  if ((!readString(to) && !Array.isArray(to)) || !subject || !body) throw new ValidationError("Email requires to, subject, and body.");
  return { to: to as NodeFlowJsonValue, subject, body, ...(readString(context.config.from) ? { from: readString(context.config.from)! } : {}) };
}
function compare(actual: unknown, expected: unknown, operator: string): boolean {
  switch (operator) {
    case "truthy": return Boolean(actual); case "falsy": return !actual;
    case "equals": return JSON.stringify(actual) === JSON.stringify(expected);
    case "not_equals": return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains": return typeof actual === "string" ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some((entry) => JSON.stringify(entry) === JSON.stringify(expected));
    case "greater_than": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "less_than": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    default: throw new ValidationError(`Unsupported condition operator: ${operator}.`);
  }
}
function readPath(value: unknown, path: string): unknown { return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value); }
function readString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function readObject(value: unknown): NodeFlowJsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as NodeFlowJsonObject : null; }
function toJson(value: unknown): NodeFlowJsonValue { return value === undefined ? null : JSON.parse(JSON.stringify(value)) as NodeFlowJsonValue; }
