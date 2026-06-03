import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildOtelEnv,
  buildProviderSpan,
  buildProviderLogRecord,
  OtelSpanCollector,
  parseOtelHeaders,
} from "../../../../../src/infrastructure/providers/cli/otel-span-collector.js";

// ─── buildOtelEnv ─────────────────────────────────────────────────────────────

describe("buildOtelEnv", () => {
  it("returns empty object when enabled=false", () => {
    const env = buildOtelEnv({ enabled: false });
    expect(env).toEqual({});
  });

  it("returns full default env when called with no options", () => {
    const env = buildOtelEnv();
    expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    expect(env.OTEL_METRICS_EXPORTER).toBe("otlp");
    expect(env.OTEL_LOGS_EXPORTER).toBe("otlp");
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://localhost:4318");
    expect(env.OTEL_TRACES_EXPORTER).toBeUndefined();
  });

  it("uses provided endpoint", () => {
    const env = buildOtelEnv({ endpoint: "http://my-collector:4317" });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://my-collector:4317");
  });

  it("uses provided protocol", () => {
    const env = buildOtelEnv({ protocol: "grpc" });
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("grpc");
  });

  it("includes OTEL_TRACES_EXPORTER when enableTraces=true", () => {
    const env = buildOtelEnv({ enableTraces: true });
    expect(env.OTEL_TRACES_EXPORTER).toBe("otlp");
  });

  it("passes through headers", () => {
    const env = buildOtelEnv({ headers: "Authorization=Bearer tok123" });
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer tok123");
  });

  it("sets privacy flags when enabled", () => {
    const env = buildOtelEnv({ logUserPrompts: true, logToolDetails: true });
    expect(env.OTEL_LOG_USER_PROMPTS).toBe("1");
    expect(env.OTEL_LOG_TOOL_DETAILS).toBe("1");
  });

  it("does not set privacy flags by default", () => {
    const env = buildOtelEnv();
    expect(env.OTEL_LOG_USER_PROMPTS).toBeUndefined();
    expect(env.OTEL_LOG_TOOL_DETAILS).toBeUndefined();
  });
});

// ─── parseOtelHeaders ────────────────────────────────────────────────────────

describe("parseOtelHeaders", () => {
  it("returns empty object for empty string", () => {
    expect(parseOtelHeaders("")).toEqual({});
  });

  it("returns empty object for undefined", () => {
    expect(parseOtelHeaders(undefined)).toEqual({});
  });

  it("parses key=value format", () => {
    expect(parseOtelHeaders("Authorization=Bearer tok")).toEqual({
      Authorization: "Bearer tok",
    });
  });

  it("parses key: value format", () => {
    expect(parseOtelHeaders("Authorization: Bearer tok")).toEqual({
      Authorization: "Bearer tok",
    });
  });

  it("parses multiple headers", () => {
    expect(parseOtelHeaders("Authorization=Bearer tok,X-Custom=value")).toEqual({
      Authorization: "Bearer tok",
      "X-Custom": "value",
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseOtelHeaders("  Key  =  Value  ")).toEqual({ Key: "Value" });
  });
});

// ─── buildProviderSpan ────────────────────────────────────────────────────────

describe("buildProviderSpan", () => {
  it("produces a span with required fields", () => {
    const now = Date.now();
    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-opus-4-5",
      startTimeMs: now,
      endTimeMs: now + 30_000,
      success: true,
    });

    expect(span.name).toBe("provider.invoke/claude-code");
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.kind).toBe(3); // CLIENT
    expect(span.status.code).toBe(1); // OK
    expect(span.parentSpanId).toBeUndefined();
  });

  it("marks failed spans with error status", () => {
    const now = Date.now();
    const span = buildProviderSpan({
      provider: "codex",
      model: "gpt-4o",
      startTimeMs: now,
      endTimeMs: now + 1000,
      success: false,
      errorMessage: "quota exceeded",
    });

    expect(span.status.code).toBe(2); // ERROR
    expect(span.status.message).toBe("quota exceeded");
  });

  it("includes token usage attributes", () => {
    const now = Date.now();
    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-haiku-3-5",
      startTimeMs: now,
      endTimeMs: now + 5000,
      success: true,
      inputTokens: 1000,
      outputTokens: 250,
      cacheCreationTokens: 800,
      cacheReadTokens: 200,
      reasoningTokens: 50,
    });

    const attrs = Object.fromEntries(
      span.attributes.map((a) => [a.key, Object.values(a.value)[0]]),
    );

    expect(attrs["gen_ai.usage.input_tokens"]).toBe(1000);
    expect(attrs["gen_ai.usage.output_tokens"]).toBe(250);
    expect(attrs["gen_ai.usage.total_tokens"]).toBe(1250);
    expect(attrs["gen_ai.usage.cache_creation_tokens"]).toBe(800);
    expect(attrs["gen_ai.usage.cache_read_tokens"]).toBe(200);
    expect(attrs["gen_ai.usage.reasoning_tokens"]).toBe(50);
  });

  it("uses parent trace id when provided", () => {
    const now = Date.now();
    const parentTraceId = "a".repeat(32);
    const span = buildProviderSpan({
      provider: "qwen-code",
      model: "qwen-turbo",
      startTimeMs: now,
      endTimeMs: now + 2000,
      success: true,
      parentTraceId,
      parentSpanId: "b".repeat(16),
    });

    expect(span.traceId).toBe(parentTraceId);
    expect(span.parentSpanId).toBe("b".repeat(16));
  });

  it("includes provider extension attributes", () => {
    const now = Date.now();
    const span = buildProviderSpan({
      provider: "gemini",
      model: "gemini-2.5-pro",
      startTimeMs: now,
      endTimeMs: now + 10_000,
      success: true,
      nativeSessionId: "sess-abc",
      cwd: "/workspace/repo",
      executionMode: "DOCKER",
      conversationTurns: 5,
      usageSource: "reported",
    });

    const attrs = Object.fromEntries(
      span.attributes.map((a) => [a.key, Object.values(a.value)[0]]),
    );

    expect(attrs["provider.session_id"]).toBe("sess-abc");
    expect(attrs["provider.cwd"]).toBe("/workspace/repo");
    expect(attrs["provider.execution_mode"]).toBe("DOCKER");
    expect(attrs["provider.conversation_turns"]).toBe(5);
    expect(attrs["gen_ai.usage.source"]).toBe("reported");
  });

  it("produces unique span and trace ids on every call", () => {
    const now = Date.now();
    const args = { provider: "codex", model: "gpt-4o", startTimeMs: now, endTimeMs: now + 1000, success: true };
    const span1 = buildProviderSpan(args);
    const span2 = buildProviderSpan(args);

    expect(span1.traceId).not.toBe(span2.traceId);
    expect(span1.spanId).not.toBe(span2.spanId);
  });

  it("encodes timing as nanosecond strings", () => {
    const startMs = 1_000_000;
    const endMs = 1_005_000;
    const span = buildProviderSpan({
      provider: "opencode",
      model: "claude-sonnet-4",
      startTimeMs: startMs,
      endTimeMs: endMs,
      success: true,
    });

    expect(span.startTimeUnixNano).toBe(String(startMs * 1_000_000));
    expect(span.endTimeUnixNano).toBe(String(endMs * 1_000_000));
  });
});

// ─── buildProviderLogRecord ───────────────────────────────────────────────────

describe("buildProviderLogRecord", () => {
  it("builds an info log record", () => {
    const record = buildProviderLogRecord({
      message: "Provider started",
      provider: "claude-code",
      model: "claude-opus-4-5",
    });

    expect(record.severityText).toBe("INFO");
    expect(record.severityNumber).toBe(9);
    expect(record.body.stringValue).toBe("Provider started");
  });

  it("builds a warn log record", () => {
    const record = buildProviderLogRecord({
      message: "Slow response",
      severity: "warn",
      provider: "codex",
      model: "gpt-4o",
    });

    expect(record.severityText).toBe("WARN");
    expect(record.severityNumber).toBe(13);
  });

  it("builds an error log record", () => {
    const record = buildProviderLogRecord({
      message: "API call failed",
      severity: "error",
      provider: "gemini",
      model: "gemini-2.5-flash",
    });

    expect(record.severityText).toBe("ERROR");
    expect(record.severityNumber).toBe(17);
  });

  it("includes trace/span link when provided", () => {
    const record = buildProviderLogRecord({
      message: "Tool called",
      provider: "claude-code",
      model: "claude-haiku-3-5",
      traceId: "trace-001",
      spanId: "span-001",
    });

    expect(record.traceId).toBe("trace-001");
    expect(record.spanId).toBe("span-001");
  });
});

// ─── OtelSpanCollector ────────────────────────────────────────────────────────

describe("OtelSpanCollector", () => {
  it("is inactive when no endpoint is provided", () => {
    const collector = new OtelSpanCollector();
    expect(collector.isActive).toBe(false);
  });

  it("is active when an endpoint is provided", () => {
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });
    expect(collector.isActive).toBe(true);
  });

  it("flush() is a no-op when inactive", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const collector = new OtelSpanCollector();

    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-opus-4-5",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 1000,
      success: true,
    });
    collector.addSpan(span);
    await collector.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("exports spans to the OTLP endpoint on flush()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-opus-4-5",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 1000,
      success: true,
    });
    collector.addSpan(span);
    await collector.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4318/v1/traces");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string);
    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);

    fetchSpy.mockRestore();
  });

  it("exports logs to the OTLP endpoint on flush()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const log = buildProviderLogRecord({
      message: "Test log",
      provider: "claude-code",
      model: "claude-opus-4-5",
    });
    collector.addLog(log);
    await collector.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4318/v1/logs");

    fetchSpy.mockRestore();
  });

  it("flushes both spans and logs together", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const span = buildProviderSpan({
      provider: "codex",
      model: "gpt-4o",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 500,
      success: true,
    });
    const log = buildProviderLogRecord({ message: "Done", provider: "codex", model: "gpt-4o" });

    collector.addSpan(span);
    collector.addLog(log);
    await collector.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map(([u]) => u as string).sort();
    expect(urls).toContain("http://localhost:4318/v1/logs");
    expect(urls).toContain("http://localhost:4318/v1/traces");

    fetchSpy.mockRestore();
  });

  it("clears the buffer after flush()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const span = buildProviderSpan({
      provider: "qwen-code",
      model: "qwen3-14b",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 100,
      success: true,
    });
    collector.addSpan(span);
    await collector.flush();
    fetchSpy.mockClear();

    // Second flush with nothing buffered should not call fetch
    await collector.flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("swallows fetch errors silently", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network failure"));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const span = buildProviderSpan({
      provider: "gemini",
      model: "gemini-2.5-pro",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 1000,
      success: true,
    });
    collector.addSpan(span);

    // Should NOT throw
    await expect(collector.flush()).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("recordProviderSpan() adds the span and returns it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({ endpoint: "http://localhost:4318" });

    const span = collector.recordProviderSpan({
      provider: "claude-code",
      model: "claude-sonnet-4-5",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 2000,
      success: true,
    });

    expect(span.name).toBe("provider.invoke/claude-code");
    await collector.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it("includes auth headers in OTLP export requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({
      endpoint: "http://localhost:4318",
      headers: "Authorization=Bearer my-token",
    });

    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-opus-4-5",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 100,
      success: true,
    });
    collector.addSpan(span);
    await collector.flush();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");

    fetchSpy.mockRestore();
  });

  it("includes service name in the resource block", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const collector = new OtelSpanCollector({
      endpoint: "http://localhost:4318",
      serviceName: "my-mcp-server",
      serviceVersion: "2.0.0",
    });

    const span = buildProviderSpan({
      provider: "claude-code",
      model: "claude-opus-4-5",
      startTimeMs: Date.now(),
      endTimeMs: Date.now() + 100,
      success: true,
    });
    collector.addSpan(span);
    await collector.flush();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const resourceAttrs = body.resourceSpans[0].resource.attributes as Array<{ key: string; value: { stringValue?: string } }>;
    const serviceAttr = resourceAttrs.find((a) => a.key === "service.name");
    expect(serviceAttr?.value.stringValue).toBe("my-mcp-server");

    fetchSpy.mockRestore();
  });
});
