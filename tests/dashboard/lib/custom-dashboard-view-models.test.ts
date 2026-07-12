import { describe, expect, it } from "vitest";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
} from "../../../dashboard/src/v2/types.js";
import {
  buildValidationPreviewPath,
  canPublishRevision,
  createDefaultCustomDashboardDraft,
  getDashboardStatusView,
  getRevisionValidationLabel,
  getValidationStages,
  hasDraftChanged,
  parseJsonDraft,
  redactAutomationCredentialMetadata,
  stableJsonStringify,
} from "../../../dashboard/src/v2/lib/custom-dashboard-view-models.js";

const dashboard: CustomDashboardRecord = {
  id: "dashboard-1",
  projectId: "project-1",
  title: "Delivery Pulse",
  description: "Release health",
  status: "draft",
  manifest: {
    schemaVersion: 1,
    title: "Delivery Pulse",
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx"],
  },
  fileBundle: {
    files: [{ path: "src/dashboard.tsx", content: "export default function Dashboard() { return null; }" }],
  },
  sourceNodeGraph: { nodes: [], edges: [] },
  credentialBindings: [],
  routes: [],
  styleguide: { tone: "operational" },
  runtimeMetadata: {},
  runtimeState: {
    status: "active", haltedReason: null, haltedRevisionId: null, haltedAt: null, resumedAt: null,
    updatedAt: "2026-07-07T00:00:00.000Z", recoveryMetadata: {},
  },
  publishedRevisionId: null,
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
  validationStatus: null,
  validationReport: null,
  runtimeMetadata: {},
  validatedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

describe("custom dashboard view models", () => {
  it("creates a default persisted bundle draft", () => {
    const draft = createDefaultCustomDashboardDraft("Ops Console");

    expect(draft.title).toBe("Ops Console");
    expect(draft.manifest.entryFile).toBe("src/dashboard.tsx");
    expect(draft.fileBundle.files[0]?.content).toContain("Custom dashboard revision");
    expect(draft.sourceNodeGraph?.nodes).toEqual([]);
  });

  it("parses and formats JSON drafts deterministically", () => {
    expect(parseJsonDraft<{ ok: true }>("{\"ok\":true}", "Manifest")).toEqual({ ok: true, value: { ok: true } });
    expect(parseJsonDraft("{", "Manifest")).toMatchObject({ ok: false });
    expect(stableJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJsonStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("gates publication on passed revision or matching passed session", () => {
    expect(canPublishRevision(revision)).toBe(false);
    expect(canPublishRevision({ ...revision, validationStatus: "passed", validationReport: { valid: true, issues: [] } })).toBe(true);

    const session: CustomDashboardValidationSessionRecord = {
      id: "session-1",
      dashboardId: "dashboard-1",
      revisionId: "revision-1",
      projectId: "project-1",
      status: "passed",
      validationReport: { valid: true, issues: [] },
      runtimeMetadata: {},
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:01.000Z",
    };

    expect(canPublishRevision(revision, session)).toBe(true);
    expect(canPublishRevision(revision, { ...session, revisionId: "other" })).toBe(false);
  });

  it("summarizes statuses, stages, previews, and draft dirtiness", () => {
    expect(getDashboardStatusView("published").label).toBe("Published");
    expect(getRevisionValidationLabel("building")).toBe("Building");
    expect(getValidationStages("running").map((stage) => stage.state)).toEqual(["passed", "active", "pending"]);
    expect(getValidationStages("passed").map((stage) => stage.state)).toEqual(["passed", "passed", "passed"]);
    expect(buildValidationPreviewPath("session 1")).toBe("/api/custom-dashboard-validations/session%201/proxy/");

    const draft = {
      title: dashboard.title,
      description: dashboard.description,
      manifestText: stableJsonStringify(dashboard.manifest),
      fileBundleText: stableJsonStringify(dashboard.fileBundle),
      sourceGraphText: stableJsonStringify(dashboard.sourceNodeGraph),
      routesText: stableJsonStringify(dashboard.routes),
      credentialBindingsText: stableJsonStringify([]),
      styleguideText: stableJsonStringify(dashboard.styleguide),
    };

    expect(hasDraftChanged(dashboard, draft)).toBe(false);
    expect(hasDraftChanged(dashboard, { ...draft, title: "Changed" })).toBe(true);
  });

  it("copies only the credential metadata allowlist", () => {
    const metadata = {
      id: "credential-1", name: "Build token", kind: "api-token", scope: "project" as const,
      projectId: "project-1", managementProjectId: "project-1", allowedProjectIds: ["project-1"], capabilities: ["read"],
      status: "active" as const, configured: true, keyId: "key-1", keyVersion: 1, version: 2,
      lastValidatedAt: null, validationStatus: "valid" as const, createdAt: "now", updatedAt: "now",
      value: "must-not-render",
    };
    expect(JSON.stringify(redactAutomationCredentialMetadata(metadata))).not.toContain("must-not-render");
  });
});
