import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
} from "../../../dashboard/src/v2/types.js";
import {
  buildPublishedCustomDashboardLink,
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
  styleguide: dashboard.styleguide,
  validationStatus: "passed",
  validationReport: { valid: true, summary: "Passed", issues: [] },
  runtimeMetadata: {},
  validatedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

type CustomDashboardDataSourceNode = CustomDashboardRevisionRecord["sourceNodeGraph"]["nodes"][number];

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

  it("reads declared project data, stats, and telemetry through explicit API endpoints", async () => {
    await resolveCustomDashboardRuntimeSource("project-1", { id: "project", type: "project_dashboard_data", title: "Project" });
    expect(fetch).toHaveBeenLastCalledWith("/api/projects/project-1/execution", expect.objectContaining({ cache: "no-store" }));

    await resolveCustomDashboardRuntimeSource("project-1", { id: "stats", type: "stats", title: "Stats", config: { window: "24h" } });
    expect(fetch).toHaveBeenLastCalledWith("/api/projects/project-1/stats?window=24h", expect.objectContaining({ cache: "no-store" }));

    await resolveCustomDashboardRuntimeSource("project-1", { id: "telemetry", type: "telemetry", title: "Telemetry" });
    expect(fetch).toHaveBeenLastCalledWith("/api/telemetry/overview", expect.objectContaining({ cache: "no-store" }));
  });

  it("keeps integration metadata non-secret and reports unavailable source types clearly", async () => {
    const integrations = await resolveCustomDashboardRuntimeSource("project-1", {
      id: "jira",
      type: "integrations_metadata",
      title: "Jira",
      config: { projectKey: "OPS" },
    });
    expect(integrations.data).toMatchObject({ available: true, source: { id: "jira", config: { projectKey: "OPS" } } });
    expect(fetch).not.toHaveBeenCalled();

    await expect(resolveCustomDashboardRuntimeSource("project-1", {
      id: "incidents",
      type: "external_api",
      title: "Incidents",
    })).rejects.toThrow("placeholder");

    const unsupported: CustomDashboardDataSourceNode = { id: "raw", type: "raw_sql", title: "Raw SQL" };
    await expect(resolveCustomDashboardRuntimeSource("project-1", unsupported)).rejects.toThrow("unsupported source type");
  });

  it("builds shareable published viewer links", () => {
    expect(buildPublishedCustomDashboardLink("dashboard 1", "http://localhost:4444")).toBe(
      "http://localhost:4444/custom-dashboards?dashboard=dashboard+1&mode=viewer",
    );
  });
});
