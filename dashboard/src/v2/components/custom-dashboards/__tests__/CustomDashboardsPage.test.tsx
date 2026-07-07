/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomDashboardsPage } from "../../../CustomDashboardsPage.js";
import { ProjectDataContext } from "../../../context/project-data.js";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
} from "../../../types.js";
import {
  archiveCustomDashboard,
  createCustomDashboard,
  createCustomDashboardRevision,
  fetchCustomDashboard,
  fetchCustomDashboardDataCatalog,
  fetchCustomDashboardValidationLogs,
  fetchCustomDashboardValidationSession,
  fetchCustomDashboards,
  publishCustomDashboardRevision,
  startCustomDashboardValidation,
  updateCustomDashboardDraft,
} from "../../../lib/custom-dashboard-api.js";

vi.mock("../../../lib/custom-dashboard-api.js", () => ({
  archiveCustomDashboard: vi.fn(),
  createCustomDashboard: vi.fn(),
  createCustomDashboardRevision: vi.fn(),
  fetchCustomDashboard: vi.fn(),
  fetchCustomDashboardDataCatalog: vi.fn(),
  fetchCustomDashboardValidationLogs: vi.fn(),
  fetchCustomDashboardValidationSession: vi.fn(),
  fetchCustomDashboards: vi.fn(),
  publishCustomDashboardRevision: vi.fn(),
  startCustomDashboardValidation: vi.fn(),
  updateCustomDashboardDraft: vi.fn(),
}));

vi.mock("../../../lib/motion/index.js", () => ({
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
    selectionMovement: { duration: "0ms", ease: "linear" },
  })),
  useAnimatedActiveIndicator: vi.fn(() => ({ style: {} })),
  useGsapInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: 0, ease: "linear" },
    enterExit: { duration: 0, ease: "linear" },
    selectionMovement: { duration: 0, ease: "linear" },
  })),
}));

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
    killTweensOf: vi.fn(),
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis(), fromTo: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() })),
  },
}));

vi.mock("../../ui/ActionFeedbackRegion.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    ActionFeedbackRegion: ({ message }: { message: string | null }) => {
    return message ? createElement("div", { role: "status" }, message) : null;
    },
  };
});

vi.mock("../../ui/ConfirmDialog.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    ConfirmDialog: ({ isOpen }: { isOpen: boolean }) => {
    return isOpen ? createElement("div", { role: "dialog", "aria-label": "Confirm archive" }) : null;
    },
  };
});

vi.mock("../CustomDashboardList.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    CustomDashboardList: ({ dashboards, selectedDashboardId, onSelect, onCreate }: any) => {
    return createElement(
      "section",
      { "aria-label": "Custom dashboards" },
      dashboards.map((dashboard: CustomDashboardRecord) => createElement(
        "button",
        {
          key: dashboard.id,
          type: "button",
          "aria-pressed": dashboard.id === selectedDashboardId,
          onClick: () => onSelect(dashboard.id),
        },
        dashboard.title,
      )),
      createElement("button", { type: "button", onClick: onCreate }, "New"),
    );
    },
  };
});

vi.mock("../CustomDashboardEditorPanel.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    CustomDashboardEditorPanel: () => {
    return createElement("section", { "aria-label": "Custom dashboard editor" }, "Editor");
    },
  };
});

vi.mock("../CustomDashboardValidationPanel.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    CustomDashboardValidationPanel: ({ selectedRevision, validationSession, logs, onStartValidation, onPublish }: any) => {
    const canPublish = Boolean(
      selectedRevision?.validationStatus === "passed"
        || (validationSession?.status === "passed" && validationSession.revisionId === selectedRevision?.id),
    );
    return createElement(
      "aside",
      { "aria-label": "Custom dashboard validation and publication" },
      createElement("button", { type: "button", onClick: onStartValidation }, "Validate"),
      createElement("button", { type: "button", disabled: !canPublish, onClick: onPublish }, "Publish"),
      logs ? createElement("pre", null, logs) : null,
      validationSession ? createElement("a", { href: `/api/custom-dashboard-validations/${validationSession.id}/proxy/` }, "Open validation preview") : null,
    );
    },
  };
});

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
  styleguide: { tone: "operational" },
  runtimeMetadata: {},
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
  styleguide: dashboard.styleguide,
  validationStatus: null,
  validationReport: null,
  runtimeMetadata: {},
  validatedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const passedSession: CustomDashboardValidationSessionRecord = {
  id: "session-1",
  dashboardId: "dashboard-1",
  revisionId: "revision-1",
  projectId: "project-1",
  status: "passed",
  validationReport: { valid: true, summary: "Passed", issues: [] },
  runtimeMetadata: { validation: { hostPort: 4445 } },
  startedAt: "2026-07-07T00:00:00.000Z",
  finishedAt: "2026-07-07T00:00:01.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:01.000Z",
};

const projectContext = {
  projects: [{ id: "project-1", name: "Approved Test Project", status: "ready" }],
  selectedProjectId: "project-1",
  selectedProject: { id: "project-1", name: "Approved Test Project", status: "ready" },
  loading: false,
  error: null,
  refreshProjects: vi.fn(),
  selectProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
};

const renderPage = (context: typeof projectContext | any = projectContext) => render(
  <ProjectDataContext.Provider value={context}>
    <CustomDashboardsPage />
  </ProjectDataContext.Provider>,
);

describe("CustomDashboardsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [dashboard] });
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard, revisions: [revision] });
    vi.mocked(fetchCustomDashboardDataCatalog).mockResolvedValue({
      projectId: "project-1",
      dashboards: [],
      sources: [{ id: "tasks", type: "sqlite_query", title: "Tasks", dashboardId: "dashboard-1", dashboardTitle: "Delivery Pulse" }],
    });
    vi.mocked(fetchCustomDashboardValidationLogs).mockResolvedValue({ logs: "build ok\nhealth ok" });
    vi.mocked(fetchCustomDashboardValidationSession).mockResolvedValue(passedSession);
    vi.mocked(startCustomDashboardValidation).mockResolvedValue(passedSession);
    vi.mocked(publishCustomDashboardRevision).mockResolvedValue({ ...dashboard, status: "published", publishedRevisionId: "revision-1" });
    vi.mocked(updateCustomDashboardDraft).mockResolvedValue(dashboard);
    vi.mocked(createCustomDashboard).mockResolvedValue(dashboard);
    vi.mocked(createCustomDashboardRevision).mockResolvedValue(revision);
    vi.mocked(archiveCustomDashboard).mockResolvedValue({ ...dashboard, status: "archived" });
  });

  it("renders a project placeholder when no project is selected", () => {
    renderPage({ ...projectContext, selectedProjectId: null, selectedProject: null });

    expect(screen.getByText("Select a project to manage custom dashboards.")).toBeInTheDocument();
    expect(fetchCustomDashboards).not.toHaveBeenCalled();
  });

  it("loads the workspace and keeps publish disabled until validation passes", async () => {
    renderPage();

    expect(await screen.findByText("Dashboard Workspace")).toBeInTheDocument();
    expect(await screen.findByText("Delivery Pulse")).toBeInTheDocument();
    const publishButton = screen.getByRole("button", { name: /Publish/i });
    expect(publishButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^Validate$/i }));

    await waitFor(() => {
      expect(startCustomDashboardValidation).toHaveBeenCalledWith("dashboard-1", "revision-1", "project-1");
    });
    expect(await screen.findByText(/build ok/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open validation preview/i })).toHaveAttribute(
      "href",
      "/api/custom-dashboard-validations/session-1/proxy/",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Publish/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Publish/i }));

    await waitFor(() => {
      expect(publishCustomDashboardRevision).toHaveBeenCalledWith("dashboard-1", "revision-1", "session-1");
    });
  });
});
