import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
} from "../../../dashboard/src/v2/types.js";
import {
  buildPublishedCustomDashboardLink,
  createCustomDashboardRuntimeMessageHandler,
  resolveCustomDashboardRuntimeSource,
  resolvePublishedCustomDashboardRuntime,
} from "../../../dashboard/src/v2/lib/custom-dashboard-runtime.js";

const dashboard: CustomDashboardRecord = {
  id: "dashboard-1",
  projectId: "project-1",
  title: "Delivery Pulse",
  description: "Release health",
  status: "published",
  manifest: {
    schemaVersion: 1,
    title: "Delivery Pulse",
    entryFile: "index.html",
    filePaths: ["index.html"],
  },
  fileBundle: {
    files: [{ path: "index.html", content: "<main>Published dashboard</main>", contentType: "text/html" }],
  },
  sourceNodeGraph: {
    nodes: [{ id: "stats", type: "stats", title: "Stats", config: { window: "24h" } }],
    edges: [],
  },
  credentialBindings: [],
  routes: [],
  styleguide: { tone: "operational" },
  runtimeMetadata: {},
  runtimeState: {
    status: "active",
    haltedReason: null,
    haltedRevisionId: null,
    haltedAt: null,
    resumedAt: null,
    updatedAt: "2026-07-07T00:00:00.000Z",
    recoveryMetadata: {},
  },
  publishedRevisionId: "revision-1",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const revision: CustomDashboardRevisionRecord = {
  id: "revision-1",
  dashboardId: "dashboard-1",
  projectId: "project-1",
  revisionNumber: 1,
  manifest: dashboard.manifest,
  fileBundle: dashboard.fileBundle,
  sourceNodeGraph: dashboard.sourceNodeGraph,
  credentialBindings: [],
  routes: [],
  styleguide: dashboard.styleguide,
  validationStatus: "passed",
  validationReport: { valid: true, summary: "Passed", issues: [] },
  runtimeMetadata: {},
  validatedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

describe("custom dashboard runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
  });

  it("resolves only a published revision with a passed validation report", () => {
    const ready = resolvePublishedCustomDashboardRuntime(dashboard, [revision]);
    expect(ready.status).toBe("ready");
    expect(ready.status === "ready" ? ready.runtime.document : "").toContain("Published dashboard");
    expect(ready.status === "ready" ? ready.runtime.document : "").toContain("codeUxDataBridge");

    const draft = resolvePublishedCustomDashboardRuntime({ ...dashboard, status: "draft", publishedRevisionId: null }, [revision]);
    expect(draft).toMatchObject({ status: "blocked" });
    expect(draft.status === "blocked" ? draft.reason : "").toContain("Only published");

    const failed = resolvePublishedCustomDashboardRuntime(dashboard, [
      { ...revision, validationStatus: "failed", validationReport: { valid: false, summary: "Build failed", issues: [] } },
    ]);
    expect(failed).toMatchObject({ status: "blocked" });
    expect(failed.status === "blocked" ? failed.validationReport?.summary : "").toBe("Build failed");

    const archived = resolvePublishedCustomDashboardRuntime({ ...dashboard, status: "archived" }, [revision]);
    expect(archived.status === "blocked" ? archived.reason : "").toContain("Archived");

    const halted = resolvePublishedCustomDashboardRuntime({
      ...dashboard,
      runtimeState: {
        ...dashboard.runtimeState,
        status: "halted",
        haltedReason: "Frame crashed",
        haltedRevisionId: revision.id,
        haltedAt: "2026-07-07T01:00:00.000Z",
      },
    }, [revision]);
    expect(halted.status === "blocked" ? halted.reason : "").toContain("Frame crashed");
  });

  it("reads every declared source through the shared typed gateway", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      requestId: "source-request",
      sourceId: "stats",
      status: 200,
      headers: { "content-type": "application/json" },
      data: { ok: true },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const resolved = resolvePublishedCustomDashboardRuntime(dashboard, [revision]);
    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") return;

    await resolveCustomDashboardRuntimeSource(
      resolved.runtime,
      { id: "stats", type: "stats", title: "Stats", config: { window: "24h" } },
      "source-request",
      { route: "/summary" },
    );
    expect(fetch).toHaveBeenLastCalledWith("/api/custom-dashboard-runtime/source", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      body: expect.stringContaining('"sourceId":"stats"'),
    }));
    const init = vi.mocked(fetch).mock.calls.at(-1)?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requestId: "source-request",
      projectId: "project-1",
      dashboardId: "dashboard-1",
      revisionId: "revision-1",
      access: { kind: "published" },
      sourceId: "stats",
      route: "/summary",
    });
  });

  it("checks frame source, opaque origin, bridge session, request IDs, and cancellation", async () => {
    const resolved = resolvePublishedCustomDashboardRuntime(dashboard, [revision]);
    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") return;
    const postMessage = vi.fn();
    const frameWindow = { postMessage } as unknown as Window;
    const errors: string[] = [];
    const handler = createCustomDashboardRuntimeMessageHandler({
      frameWindow,
      runtime: resolved.runtime,
      onRuntimeError: (message) => errors.push(message),
    });

    handler({
      source: {} as MessageEventSource,
      origin: "null",
      data: { type: "codeux-custom-dashboard:source-request", bridgeSessionId: resolved.runtime.bridgeSessionId, requestId: "wrong-frame", sourceId: "stats" },
    } as MessageEvent);
    handler({
      source: frameWindow,
      origin: "https://attacker.example",
      data: { type: "codeux-custom-dashboard:source-request", bridgeSessionId: resolved.runtime.bridgeSessionId, requestId: "wrong-origin", sourceId: "stats" },
    } as MessageEvent);
    handler({
      source: frameWindow,
      origin: "null",
      data: { type: "codeux-custom-dashboard:source-request", bridgeSessionId: "wrong-session", requestId: "wrong-session", sourceId: "stats" },
    } as MessageEvent);
    expect(fetch).not.toHaveBeenCalled();

    handler({
      source: frameWindow,
      origin: "null",
      data: { type: "codeux-custom-dashboard:source-request", bridgeSessionId: resolved.runtime.bridgeSessionId, sourceId: "stats" },
    } as MessageEvent);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "codeux-custom-dashboard:source-response",
      bridgeSessionId: resolved.runtime.bridgeSessionId,
      ok: false,
    }), "*");

    handler({
      source: frameWindow,
      origin: "null",
      data: { type: "codeux-custom-dashboard:source-cancel", bridgeSessionId: resolved.runtime.bridgeSessionId, requestId: "cancelled" },
    } as MessageEvent);
    expect(errors).toEqual([]);
  });

  it("persists one bounded halt per frame instance without throwing into the host shell", async () => {
    const resolved = resolvePublishedCustomDashboardRuntime(dashboard, [revision]);
    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") return;
    const frameWindow = { postMessage: vi.fn() } as unknown as Window;
    const errors: string[] = [];
    const controller = new AbortController();
    const handler = createCustomDashboardRuntimeMessageHandler({
      frameWindow,
      runtime: resolved.runtime,
      onRuntimeError: (message) => errors.push(message),
      signal: controller.signal,
      readinessTimeoutMs: 60_000,
    });
    const event = {
      source: frameWindow,
      origin: "null",
      data: {
        type: "codeux-custom-dashboard:runtime-error",
        bridgeSessionId: resolved.runtime.bridgeSessionId,
        message: `token=private ${"x".repeat(500)}`,
      },
    } as MessageEvent;

    expect(() => handler(event)).not.toThrow();
    handler(event);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("private");
    expect(errors[0]?.length).toBeLessThanOrEqual(320);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      revisionId: revision.id,
      reason: expect.stringContaining("[REDACTED]"),
    });
    controller.abort();
  });

  it("does not serialize credential bindings or values into published bridge payloads", () => {
    const credentialRevision = {
      ...revision,
      sourceNodeGraph: {
        nodes: [{ id: "external", type: "external_api", title: "External", credentialSlots: [{ slot: "token", label: "Token", required: true, allowedKinds: ["api-token"], requiredCapability: "read" }] }],
        edges: [],
      },
      credentialBindings: [{
        slot: "token",
        credentialId: "credential-1",
        capability: "read",
        bindingKey: "custom-dashboard:dashboard-1:token",
        credential: { id: "credential-1", name: "Token", kind: "api-token", scope: "project" as const, capabilities: ["read"], status: "active" as const, configured: true },
      }],
    };
    const resolved = resolvePublishedCustomDashboardRuntime(dashboard, [credentialRevision]);
    expect(resolved.status).toBe("ready");
    const document = resolved.status === "ready" ? resolved.runtime.document : "";
    expect(document).toContain("credentialSlots");
    expect(document).not.toContain("credential-1");
    expect(document).not.toContain("custom-dashboard:dashboard-1:token");
  });

  it("builds shareable published viewer links", () => {
    expect(buildPublishedCustomDashboardLink("dashboard 1", "http://localhost:4444")).toBe(
      "http://localhost:4444/custom-dashboards?dashboard=dashboard+1&mode=viewer",
    );
    expect(buildPublishedCustomDashboardLink("dashboard 1", "http://localhost:4444", "/logs")).toBe(
      "http://localhost:4444/custom-dashboards?dashboard=dashboard+1&mode=viewer&route=%2Flogs",
    );
  });

  it("selects route-specific entries from host route state and normalizes unknown routes", () => {
    const routedRevision: CustomDashboardRevisionRecord = {
      ...revision,
      manifest: { ...revision.manifest, entryFile: "src/overview.tsx", filePaths: ["src/overview.tsx", "src/details.tsx"] },
      fileBundle: {
        files: [
          { path: "src/overview.tsx", content: "export default () => 'Overview';" },
          { path: "src/details.tsx", content: "export default () => 'Details';" },
        ],
      },
      routes: [
        { path: "/", label: "Overview", entryFile: "src/overview.tsx" },
        { path: "/details", label: "Details", entryFile: "src/details.tsx" },
      ],
    };

    const details = resolvePublishedCustomDashboardRuntime(dashboard, [routedRevision], "/details");
    expect(details.status).toBe("ready");
    expect(details.status === "ready" ? details.runtime.routePath : null).toBe("/details");
    expect(details.status === "ready" ? details.runtime.document : "").toContain('"routePath":"/details"');

    const unknown = resolvePublishedCustomDashboardRuntime(dashboard, [routedRevision], "/undeclared");
    expect(unknown.status === "ready" ? unknown.runtime.routePath : null).toBe("/");
    expect(unknown.status === "ready" ? unknown.runtime.document : "").toContain('"routePath":"/"');
  });

  it("rejects undeclared frame navigation while accepting declared history restoration", () => {
    const routedRevision = {
      ...revision,
      routes: [{ path: "/details", label: "Details", entryFile: revision.manifest.entryFile }],
    };
    const resolved = resolvePublishedCustomDashboardRuntime(dashboard, [routedRevision], "/details");
    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") return;
    const frameWindow = { postMessage: vi.fn() } as unknown as Window;
    const onRouteChange = vi.fn();
    const controller = new AbortController();
    const handler = createCustomDashboardRuntimeMessageHandler({
      frameWindow,
      runtime: resolved.runtime,
      onRuntimeError: vi.fn(),
      onRouteChange,
      signal: controller.signal,
      readinessTimeoutMs: 60_000,
    });
    const routeEvent = (route: string): MessageEvent => ({
      source: frameWindow,
      origin: "null",
      data: { type: "codeux-custom-dashboard:route-change", bridgeSessionId: resolved.runtime.bridgeSessionId, route },
    }) as MessageEvent;

    handler(routeEvent("/undeclared"));
    handler(routeEvent("/details"));

    expect(onRouteChange).toHaveBeenCalledOnce();
    expect(onRouteChange).toHaveBeenCalledWith("/details");
    expect(resolved.runtime.document).toContain("window.addEventListener('popstate'");
    expect(resolved.runtime.document).toContain("event.state?.route");
    controller.abort();
  });
});
