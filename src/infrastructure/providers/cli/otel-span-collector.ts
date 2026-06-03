/**
 * Lightweight OpenTelemetry span/metric collector for provider invocations.
 *
 * Claude Code (and future providers) can emit OTLP telemetry when the
 * following environment variables are set by the caller:
 *
 *   CLAUDE_CODE_ENABLE_TELEMETRY=1
 *   OTEL_METRICS_EXPORTER=otlp
 *   OTEL_LOGS_EXPORTER=otlp
 *   OTEL_TRACES_EXPORTER=otlp          (optional, beta)
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>
 *   OTEL_LOG_USER_PROMPTS=1            (optional: include prompt text)
 *   OTEL_LOG_TOOL_DETAILS=1            (optional: include tool arguments)
 *
 * This module provides:
 *   1. `buildOtelEnv(opts)` — merges the OTEL env vars into a process-env
 *      fragment to forward to CLI provider subprocesses.
 *   2. `OtelSpanCollector` — a minimal, dependency-free span/event buffer that
 *      lets us collect and forward provider telemetry without pulling in the
 *      full `@opentelemetry/sdk-*` runtime.  When a real OTLP endpoint is
 *      configured the collector flushes spans via `fetch`; otherwise it
 *      operates as a no-op sink so the rest of the system stays unchanged.
 *   3. `buildProviderSpan(args)` — creates a structured span record from the
 *      typed fields we already collect (usage, provider, model, session id,
 *      conversation summary) so callers don't need to know the OTLP wire
 *      format.
 *
 * Design constraints:
 *   - Zero runtime dependencies beyond `node:` built-ins (no npm packages).
 *   - Every public API is synchronous where possible; async only for I/O.
 *   - Fully tree-shakeable: importing only `buildOtelEnv` does not pull in the
 *     collector or the HTTP logic.
 *   - Compatible with every provider: Codex, Qwen, OpenCode, Gemini, Claude
 *     Code, and Antigravity all use the same span shape.
 */

// ─── OTLP wire types (subset of the protobuf spec we actually use) ───────────

/** An OTLP attribute key-value pair. */
export interface OtelAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: number }
    | { doubleValue: number }
    | { boolValue: boolean };
}

/** A minimal OTLP span record (traces signal). */
export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // SpanKind: 1=INTERNAL, 2=SERVER, 3=CLIENT, 4=PRODUCER, 5=CONSUMER
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttribute[];
  status: { code: number; message?: string }; // 0=UNSET, 1=OK, 2=ERROR
  events?: OtelSpanEvent[];
}

/** An event attached to a span (e.g. a tool call or an API response). */
export interface OtelSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes?: OtelAttribute[];
}

/** An OTLP log record (logs signal). */
export interface OtelLogRecord {
  timeUnixNano: string;
  severityNumber: number; // 9=INFO, 13=WARN, 17=ERROR
  severityText: string;
  body: { stringValue: string };
  attributes: OtelAttribute[];
  traceId?: string;
  spanId?: string;
}

// ─── Environment-variable builder ────────────────────────────────────────────

export interface OtelEnvOptions {
  /**
   * Base endpoint for the OTLP receiver.
   * Defaults to `http://localhost:4318` (standard gRPC/HTTP collector port).
   */
  endpoint?: string;
  /**
   * Wire protocol: `"grpc"` or `"http/json"`.
   * Defaults to `"http/json"` (works without gRPC native bindings).
   */
  protocol?: "grpc" | "http/json";
  /**
   * Raw header string forwarded to OTEL_EXPORTER_OTLP_HEADERS.
   * Format: `"Key1=Value1,Key2=Value2"`.
   */
  headers?: string;
  /** Enable telemetry export. Defaults to true. */
  enabled?: boolean;
  /** Include user-prompt text in logs. Defaults to false (privacy). */
  logUserPrompts?: boolean;
  /** Include tool call arguments in logs. Defaults to false (privacy). */
  logToolDetails?: boolean;
  /** Enable traces export (beta). Defaults to false. */
  enableTraces?: boolean;
}

/**
 * Builds a `NodeJS.ProcessEnv`-compatible fragment that configures Claude Code
 * (and any other OTEL-aware CLI provider) to export telemetry to the given
 * endpoint.
 *
 * Merges cleanly with existing process environment — only overrides keys that
 * are explicitly specified.
 */
export function buildOtelEnv(opts: OtelEnvOptions = {}): NodeJS.ProcessEnv {
  if (opts.enabled === false) {
    return {};
  }

  const endpoint = opts.endpoint?.trim() || "http://localhost:4318";
  const protocol = opts.protocol || "http/json";

  const env: NodeJS.ProcessEnv = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
  };

  if (opts.enableTraces) {
    env.OTEL_TRACES_EXPORTER = "otlp";
  }

  if (opts.headers) {
    env.OTEL_EXPORTER_OTLP_HEADERS = opts.headers;
  }

  if (opts.logUserPrompts) {
    env.OTEL_LOG_USER_PROMPTS = "1";
  }

  if (opts.logToolDetails) {
    env.OTEL_LOG_TOOL_DETAILS = "1";
  }

  return env;
}

// ─── Span builder ─────────────────────────────────────────────────────────────

export interface ProviderSpanArgs {
  /** Provider identifier (e.g. "claude-code", "codex", "qwen-code"). */
  provider: string;
  /** Model identifier (e.g. "claude-opus-4-5"). */
  model: string;
  /** Optional native session / thread id assigned by the provider. */
  nativeSessionId?: string | null;
  /** Wall-clock start time of the provider invocation. */
  startTimeMs: number;
  /** Wall-clock end time of the provider invocation. */
  endTimeMs: number;
  /** Whether the invocation completed successfully. */
  success: boolean;
  /** Error message if `success` is false. */
  errorMessage?: string;
  /** Input token count reported by the provider (0 when unavailable). */
  inputTokens?: number;
  /** Output token count reported by the provider (0 when unavailable). */
  outputTokens?: number;
  /** Cache-creation input tokens (Anthropic-specific). */
  cacheCreationTokens?: number;
  /** Cache-read input tokens (Anthropic-specific). */
  cacheReadTokens?: number;
  /** Reasoning/thinking output tokens. */
  reasoningTokens?: number;
  /** How the usage figures were obtained. */
  usageSource?: "reported" | "estimated" | "unavailable";
  /** Number of conversation turns in the parsed transcript. */
  conversationTurns?: number;
  /** Working directory the provider was run in. */
  cwd?: string;
  /** Execution mode ("HOST" or "DOCKER"). */
  executionMode?: string;
  /**
   * Optional parent span context for trace propagation.
   * When provided, the span will be linked as a child of this span.
   */
  parentSpanId?: string;
  parentTraceId?: string;
}

/** 16-byte (32 hex char) random trace id. */
function randomTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 8-byte (16 hex char) random span id. */
function randomSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Converts epoch-ms to the nanosecond string OTLP expects. */
function msToNano(ms: number): string {
  return String(ms * 1_000_000);
}

function strAttr(key: string, value: string): OtelAttribute {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtelAttribute {
  return { key, value: { intValue: value } };
}

/**
 * Builds a single OTLP span record that captures the full provider invocation.
 * The span includes well-known semantic attributes aligned with the
 * OpenTelemetry GenAI semantic conventions (draft):
 *   `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`
 * plus provider-specific extension attributes under the `provider.*` namespace.
 */
export function buildProviderSpan(args: ProviderSpanArgs): OtelSpan {
  const traceId = args.parentTraceId ?? randomTraceId();
  const spanId = randomSpanId();
  const durationMs = Math.max(0, args.endTimeMs - args.startTimeMs);

  const attributes: OtelAttribute[] = [
    // GenAI semantic conventions
    strAttr("gen_ai.system", args.provider),
    strAttr("gen_ai.request.model", args.model),
    strAttr("gen_ai.usage.source", args.usageSource ?? "unavailable"),
    intAttr("gen_ai.usage.input_tokens", args.inputTokens ?? 0),
    intAttr("gen_ai.usage.output_tokens", args.outputTokens ?? 0),
    intAttr("gen_ai.usage.total_tokens", (args.inputTokens ?? 0) + (args.outputTokens ?? 0)),
    // Provider-specific extensions
    strAttr("provider.id", args.provider),
    intAttr("provider.duration_ms", durationMs),
    intAttr("provider.conversation_turns", args.conversationTurns ?? 0),
  ];

  if (args.cacheCreationTokens != null && args.cacheCreationTokens > 0) {
    attributes.push(intAttr("gen_ai.usage.cache_creation_tokens", args.cacheCreationTokens));
  }
  if (args.cacheReadTokens != null && args.cacheReadTokens > 0) {
    attributes.push(intAttr("gen_ai.usage.cache_read_tokens", args.cacheReadTokens));
  }
  if (args.reasoningTokens != null && args.reasoningTokens > 0) {
    attributes.push(intAttr("gen_ai.usage.reasoning_tokens", args.reasoningTokens));
  }
  if (args.nativeSessionId) {
    attributes.push(strAttr("provider.session_id", args.nativeSessionId));
  }
  if (args.cwd) {
    attributes.push(strAttr("provider.cwd", args.cwd));
  }
  if (args.executionMode) {
    attributes.push(strAttr("provider.execution_mode", args.executionMode));
  }

  return {
    traceId,
    spanId,
    ...(args.parentSpanId ? { parentSpanId: args.parentSpanId } : {}),
    name: `provider.invoke/${args.provider}`,
    kind: 3, // CLIENT
    startTimeUnixNano: msToNano(args.startTimeMs),
    endTimeUnixNano: msToNano(args.endTimeMs),
    attributes,
    status: args.success
      ? { code: 1 } // OK
      : { code: 2, message: args.errorMessage ?? "provider invocation failed" },
  };
}

// ─── Span Collector ───────────────────────────────────────────────────────────

export interface OtelCollectorOptions {
  /**
   * OTLP HTTP/JSON endpoint base URL (e.g. `http://localhost:4318`).
   * When omitted or empty the collector operates as a no-op.
   */
  endpoint?: string;
  /**
   * Headers appended to every OTLP export request.
   * Key-value pairs in the `"K=V"` or `"K: V"` format, comma-separated.
   */
  headers?: string;
  /** Service name included in every resource bundle. */
  serviceName?: string;
  /** Service version string. */
  serviceVersion?: string;
  /** Maximum number of spans to buffer before auto-flushing. Defaults to 100. */
  batchSize?: number;
  /**
   * Timeout in milliseconds for each OTLP export HTTP request.
   * Defaults to 5 000 ms.
   */
  exportTimeoutMs?: number;
}

/**
 * A minimal, dependency-free OTLP/HTTP span and log collector.
 *
 * Usage:
 * ```ts
 * const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });
 * const span = buildProviderSpan({ ... });
 * collector.addSpan(span);
 * await collector.flush();
 * ```
 *
 * The collector is designed to be long-lived (created once per server process)
 * and thread-safe enough for sequential async usage.  It does not implement
 * retry logic: failed exports are silently swallowed so a misconfigured
 * collector never breaks the main execution path.
 */
export class OtelSpanCollector {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly resource: Record<string, unknown>;
  private readonly batchSize: number;
  private readonly exportTimeoutMs: number;
  private readonly spans: OtelSpan[] = [];
  private readonly logs: OtelLogRecord[] = [];

  constructor(opts: OtelCollectorOptions = {}) {
    this.endpoint = opts.endpoint?.trim() ?? "";
    this.headers = parseOtelHeaders(opts.headers);
    this.batchSize = opts.batchSize ?? 100;
    this.exportTimeoutMs = opts.exportTimeoutMs ?? 5_000;

    // Build the OTLP resource block once.
    const attributes: OtelAttribute[] = [
      strAttr("service.name", opts.serviceName ?? "jules-agent-mcp"),
    ];
    if (opts.serviceVersion) {
      attributes.push(strAttr("service.version", opts.serviceVersion));
    }
    this.resource = { attributes };
  }

  /** Whether the collector has a real endpoint configured. */
  get isActive(): boolean {
    return this.endpoint.length > 0;
  }

  /** Buffer a span for the next flush. */
  addSpan(span: OtelSpan): void {
    this.spans.push(span);
    if (this.spans.length >= this.batchSize) {
      void this.flush();
    }
  }

  /** Buffer a log record for the next flush. */
  addLog(log: OtelLogRecord): void {
    this.logs.push(log);
    if (this.logs.length >= this.batchSize) {
      void this.flush();
    }
  }

  /**
   * Convenience method: build a standard provider span and buffer it in one
   * call.  Returns the span so callers can attach events or inspect ids.
   */
  recordProviderSpan(args: ProviderSpanArgs): OtelSpan {
    const span = buildProviderSpan(args);
    this.addSpan(span);
    return span;
  }

  /**
   * Flushes all buffered spans and logs to the configured OTLP endpoint.
   * Returns silently when no endpoint is configured or the buffer is empty.
   */
  async flush(): Promise<void> {
    if (!this.isActive) return;

    const spansToSend = this.spans.splice(0);
    const logsToSend = this.logs.splice(0);

    const flushOps: Promise<void>[] = [];

    if (spansToSend.length > 0) {
      flushOps.push(this.exportSpans(spansToSend));
    }
    if (logsToSend.length > 0) {
      flushOps.push(this.exportLogs(logsToSend));
    }

    await Promise.allSettled(flushOps);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async exportSpans(spans: OtelSpan[]): Promise<void> {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: this.resource,
          scopeSpans: [
            {
              scope: { name: "jules-agent-mcp/provider-runner" },
              spans,
            },
          ],
        },
      ],
    });

    await this.postOtlp(`${this.endpoint}/v1/traces`, body);
  }

  private async exportLogs(logs: OtelLogRecord[]): Promise<void> {
    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: this.resource,
          scopeLogs: [
            {
              scope: { name: "jules-agent-mcp/provider-runner" },
              logRecords: logs,
            },
          ],
        },
      ],
    });

    await this.postOtlp(`${this.endpoint}/v1/logs`, body);
  }

  private async postOtlp(url: string, body: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.exportTimeoutMs);
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body,
        signal: controller.signal,
      });
    } catch {
      // Silently swallow: a misconfigured collector must not break the agent.
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── Log record builder ───────────────────────────────────────────────────────

/**
 * Builds an OTLP log record describing a single provider invocation event.
 * Suitable for appending to an `OtelSpanCollector` log buffer.
 */
export function buildProviderLogRecord(args: {
  message: string;
  severity?: "info" | "warn" | "error";
  provider: string;
  model: string;
  nativeSessionId?: string | null;
  timestampMs?: number;
  traceId?: string;
  spanId?: string;
  extraAttributes?: OtelAttribute[];
}): OtelLogRecord {
  const severity = args.severity ?? "info";
  const severityNumber = severity === "error" ? 17 : severity === "warn" ? 13 : 9;
  const ts = msToNano(args.timestampMs ?? Date.now());

  const attributes: OtelAttribute[] = [
    strAttr("gen_ai.system", args.provider),
    strAttr("gen_ai.request.model", args.model),
    ...(args.nativeSessionId ? [strAttr("provider.session_id", args.nativeSessionId)] : []),
    ...(args.extraAttributes ?? []),
  ];

  return {
    timeUnixNano: ts,
    severityNumber,
    severityText: severity.toUpperCase(),
    body: { stringValue: args.message },
    attributes,
    ...(args.traceId ? { traceId: args.traceId } : {}),
    ...(args.spanId ? { spanId: args.spanId } : {}),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses the OTEL_EXPORTER_OTLP_HEADERS format (`Key=Value,Key2=Value2` or
 * `Key: Value, Key2: Value2`) into a plain record suitable for `fetch` headers.
 */
export function parseOtelHeaders(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");
    const colonIdx = pair.indexOf(":");
    const separatorIdx =
      eqIdx >= 0 && (colonIdx < 0 || eqIdx < colonIdx) ? eqIdx : colonIdx;
    if (separatorIdx < 0) continue;
    const key = pair.slice(0, separatorIdx).trim();
    const value = pair.slice(separatorIdx + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}
