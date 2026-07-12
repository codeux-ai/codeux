/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomDashboardViewer } from "../CustomDashboardViewer.js";
import type { CustomDashboardRecord, CustomDashboardRevisionRecord } from "../../../types.js";
import { createDefaultCustomDashboardDraft } from "../../../lib/custom-dashboard-view-models.js";

vi.mock("../../../lib/motion/tokens.js", () => ({
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
  })),
}));

vi.mock("../../../lib/motion/constants.js", () => ({
  useGsapInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: 0, ease: "linear" },
    inlineValidation: { duration: 0, ease: "linear" },
  })),
}));

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
}));

vi.mock("gsap", () => ({
  default: {
    context: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

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
    nodes: [{ id: "incidents", type: "external_api", title: "Incidents" }],
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
  credentialBindings: dashboard.credentialBindings,
  routes: dashboard.routes,
  styleguide: dashboard.styleguide,
  validationStatus: "passed",
  validationReport: { valid: true, summary: "Passed", issues: [] },
  runtimeMetadata: {},
  validatedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

describe("CustomDashboardViewer", () => {
  const onRefresh = vi.fn();
  const onReturnToEditor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a sandboxed iframe for a published validated revision", () => {
    render(
      <CustomDashboardViewer
        dashboard={dashboard}
        revisions={[revision]}
        onRefresh={onRefresh}
        onReturnToEditor={onReturnToEditor}
      />,
    );

    const iframe = screen.getByTitle("Published custom dashboard: Delivery Pulse");
    expect(iframe).toHaveAttribute("sandbox", "allow-forms allow-popups allow-scripts");
    expect(iframe).toHaveAttribute("srcdoc", expect.stringContaining("Published dashboard"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh published dashboard" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Return to editor" }));
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
  });

  it("opens a published dashboard created from the default TSX draft with its validated viewer artifact", () => {
    const defaultDraft = createDefaultCustomDashboardDraft("Untitled Dashboard");
    const defaultDashboard: CustomDashboardRecord = {
      ...dashboard,
      id: "dashboard-default",
      title: defaultDraft.title,
      description: defaultDraft.description ?? "",
      manifest: defaultDraft.manifest,
      fileBundle: defaultDraft.fileBundle,
      sourceNodeGraph: defaultDraft.sourceNodeGraph ?? { nodes: [], edges: [] },
      styleguide: defaultDraft.styleguide ?? {},
      publishedRevisionId: "revision-default",
    };
    const defaultRevision: CustomDashboardRevisionRecord = {
      ...revision,
      id: "revision-default",
      dashboardId: defaultDashboard.id,
      manifest: defaultDraft.manifest,
      fileBundle: defaultDraft.fileBundle,
      sourceNodeGraph: defaultDashboard.sourceNodeGraph,
      styleguide: defaultDashboard.styleguide,
      runtimeMetadata: {
        validation: {
          viewerArtifact: {
            kind: "vite-dist",
            entryFile: "index.html",
            files: [
              {
                path: "index.html",
                content: [
                  "<!doctype html>",
                  "<html>",
                  "<head><link rel=\"stylesheet\" href=\"/assets/index.css\"></head>",
                  "<body><div id=\"app\"></div><script type=\"module\" src=\"/assets/index.js\"></script></body>",
                  "</html>",
                ].join("\n"),
                contentType: "text/html",
              },
              { path: "assets/index.css", content: "main{color:#0f172a;}", contentType: "text/css" },
              {
                path: "assets/index.js",
                content: "document.getElementById('app').textContent = 'Custom dashboard revision';",
                contentType: "text/javascript",
              },
            ],
          },
        },
      },
    };

    render(
      <CustomDashboardViewer
        dashboard={defaultDashboard}
        revisions={[defaultRevision]}
        onRefresh={onRefresh}
        onReturnToEditor={onReturnToEditor}
      />,
    );

    const iframe = screen.getByTitle("Published custom dashboard: Untitled Dashboard");
    expect(iframe).toHaveAttribute("srcdoc", expect.stringContaining("Custom dashboard revision"));
    expect(iframe).toHaveAttribute("srcdoc", expect.stringContaining("codeUxDataBridge"));
    expect(iframe).not.toHaveAttribute("srcdoc", expect.stringContaining("not directly executable"));
  });

  it("blocks drafts and shows the validation report with a validate/publish action", () => {
    render(
      <CustomDashboardViewer
        dashboard={{ ...dashboard, status: "draft", publishedRevisionId: null }}
        revisions={[{ ...revision, validationReport: { valid: false, summary: "Build failed", issues: [{ field: "runtime", code: "failed", message: "Vite failed" }] } }]}
        onRefresh={onRefresh}
        onReturnToEditor={onReturnToEditor}
      />,
    );

    expect(screen.getByText("Published viewer unavailable")).toBeInTheDocument();
    expect(screen.getByText("Build failed")).toBeInTheDocument();
    expect(screen.getByText(/Vite failed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Validate / Publish" }));
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
  });

  it("contains runtime errors reported from the iframe", async () => {
    render(
      <CustomDashboardViewer
        dashboard={dashboard}
        revisions={[revision]}
        onRefresh={onRefresh}
        onReturnToEditor={onReturnToEditor}
      />,
    );
    const iframe = screen.getByTitle("Published custom dashboard: Delivery Pulse") as HTMLIFrameElement;
    const bridgeSessionId = iframe.getAttribute("srcdoc")?.match(/"bridgeSessionId":"([^"]+)"/)?.[1];

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "codeux-custom-dashboard:runtime-error", bridgeSessionId, message: "Frame exploded" },
      source: iframe.contentWindow,
      origin: "null",
    }));

    expect(await screen.findByRole("alert", { name: "Custom dashboard runtime failure" })).toHaveTextContent("Frame exploded");
  });

  it("returns source errors to the isolated frame without throwing in the app shell", async () => {
    render(
      <CustomDashboardViewer
        dashboard={dashboard}
        revisions={[revision]}
        onRefresh={onRefresh}
        onReturnToEditor={onReturnToEditor}
      />,
    );
    const iframe = screen.getByTitle("Published custom dashboard: Delivery Pulse") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const bridgeSessionId = iframe.getAttribute("srcdoc")?.match(/"bridgeSessionId":"([^"]+)"/)?.[1];

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "codeux-custom-dashboard:source-request", bridgeSessionId, requestId: "request-1", sourceId: "incidents" },
      source: iframe.contentWindow,
      origin: "null",
    }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "codeux-custom-dashboard:source-response",
          requestId: "request-1",
          ok: false,
          error: expect.any(String),
        }),
        "*",
      );
    });
  });
});
