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
  });
});
