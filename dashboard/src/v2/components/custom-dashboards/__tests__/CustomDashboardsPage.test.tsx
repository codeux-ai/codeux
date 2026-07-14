/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
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
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

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
    ConfirmDialog: ({ isOpen, options, onConfirm, onCancel }: any) => {
    return isOpen ? createElement(
      "div",
      { role: "dialog", "aria-label": options.title },
      createElement("p", null, options.body),
      createElement("button", { type: "button", onClick: onConfirm }, options.confirmLabel),
      createElement("button", { type: "button", onClick: onCancel }, options.cancelLabel),
    ) : null;
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

const passedRevision: CustomDashboardRevisionRecord = {
  ...revision,
  validationStatus: "passed",
  validationReport: { valid: true, summary: "Passed", issues: [] },
  validatedAt: "2026-07-07T00:00:01.000Z",
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

const renderPage = (
  context: typeof projectContext | any = projectContext,
  locale: DashboardLocale = "en",
) => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}>
    <ProjectDataContext.Provider value={context}>
      <CustomDashboardsPage />
    </ProjectDataContext.Provider>
  </DashboardI18nProvider>,
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
    const publishButton = screen.getByRole("button", { name: /^Publish$/i });
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
      expect(screen.getByRole("button", { name: /^Publish$/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Publish$/i }));

    await waitFor(() => {
      expect(publishCustomDashboardRevision).toHaveBeenCalledWith("dashboard-1", "revision-1", "session-1");
    });
  });

  it("supports the German create, edit, revision, validation, publish, and archive flow", async () => {
    renderPage(projectContext, "de");

    expect(await screen.findByText("Dashboard-Arbeitsbereich")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Release health")).toBeInTheDocument();
    expect(screen.getByText("Delivery Pulse")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Neu" }));
    await waitFor(() => expect(createCustomDashboard).toHaveBeenCalledTimes(1));

    const titleInput = await screen.findByLabelText("Titel");
    fireEvent.input(titleInput, { target: { value: "Lieferstatus – Benutzerinhalt" } });
    fireEvent.input(screen.getByLabelText("Beschreibung"), { target: { value: "Beschreibung bleibt exakt" } });
    fireEvent.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => {
      expect(updateCustomDashboardDraft).toHaveBeenCalledWith(
        "dashboard-1",
        expect.objectContaining({
          title: "Lieferstatus – Benutzerinhalt",
          description: "Beschreibung bleibt exakt",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Revision erstellen" }));
    await waitFor(() => expect(createCustomDashboardRevision).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Validieren" }));
    await waitFor(() => expect(startCustomDashboardValidation).toHaveBeenCalledWith("dashboard-1", "revision-1", "project-1"));
    await waitFor(() => expect(screen.getByLabelText("Validierungsprotokolle").textContent).toBe("build ok\nhealth ok"));
    expect(screen.getByRole("link", { name: "Validierungsvorschau öffnen" })).toHaveAttribute(
      "href",
      "/api/custom-dashboard-validations/session-1/proxy/",
    );

    const publishButton = screen.getByRole("button", { name: "Veröffentlichen" });
    await waitFor(() => expect(publishButton).toBeEnabled());
    fireEvent.click(publishButton);
    await waitFor(() => expect(publishCustomDashboardRevision).toHaveBeenCalledWith("dashboard-1", "revision-1", "session-1"));

    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    const dialog = await screen.findByRole("dialog", { name: "Benutzerdefiniertes Dashboard archivieren?" });
    expect(dialog).toHaveTextContent("Beim Archivieren wird die aktive Veröffentlichung aufgehoben");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archivieren" }));
    await waitFor(() => expect(archiveCustomDashboard).toHaveBeenCalledWith("dashboard-1"));
  });

  it("rolls back to an earlier validated revision and restores revision-menu focus", async () => {
    const olderRevision = { ...passedRevision, id: "revision-older", revisionNumber: 1 };
    const newerRevision = { ...passedRevision, id: "revision-newer", revisionNumber: 2 };
    const publishedDashboard = { ...dashboard, status: "published" as const, publishedRevisionId: newerRevision.id };
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [publishedDashboard] });
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: publishedDashboard, revisions: [olderRevision, newerRevision] });
    vi.mocked(publishCustomDashboardRevision).mockResolvedValue({ ...publishedDashboard, publishedRevisionId: olderRevision.id });

    renderPage(projectContext, "de");

    const menuTrigger = await screen.findByRole("button", { name: "Revisionsmenü öffnen" });
    menuTrigger.focus();
    fireEvent.click(menuTrigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revision 1 · Validiert" }));
    await waitFor(() => expect(menuTrigger).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Veröffentlichen" }));
    await waitFor(() => expect(publishCustomDashboardRevision).toHaveBeenCalledWith(
      "dashboard-1",
      "revision-older",
      undefined,
    ));
  });

  it("keeps network, stale-revision, build-log, filename, and source diagnostics verbatim in German", async () => {
    const longPath = `src/${"sehr-langer-dateiname-".repeat(8)}.tsx`;
    const rawNetworkError = "HTTP 503 upstream-dashboard-service";
    const rawBuildLog = `${"vite:warn unveränderte-ausgabe ".repeat(20)}\n/path/Datei.tsx:17`;
    const failedSession: CustomDashboardValidationSessionRecord = {
      ...passedSession,
      status: "failed",
      validationReport: {
        valid: false,
        summary: "docker build exited 17",
        issues: [{ field: "runtime", code: "validation_failed", message: "docker build exited 17" }],
      },
    };
    const longFileDashboard = {
      ...dashboard,
      fileBundle: { files: [{ path: longPath, content: "export const BenutzerCode = 'UNCHANGED';", contentType: "text/typescript-jsx" }] },
    };
    vi.mocked(fetchCustomDashboards).mockRejectedValueOnce(new Error(rawNetworkError)).mockResolvedValue({ dashboards: [longFileDashboard] });
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: longFileDashboard, revisions: [revision] });
    vi.mocked(startCustomDashboardValidation).mockResolvedValue(failedSession);
    vi.mocked(fetchCustomDashboardValidationLogs).mockResolvedValue({ logs: rawBuildLog });

    renderPage(projectContext, "de");

    expect(await screen.findByText(rawNetworkError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
    expect(await screen.findByText("Delivery Pulse")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Dateien" }));
    expect(screen.getByText(longPath)).toBeInTheDocument();
    expect(screen.getByLabelText("Inhalt der ausgewählten Datei")).toHaveValue("export const BenutzerCode = 'UNCHANGED';");

    fireEvent.click(screen.getByRole("button", { name: "Validieren" }));
    await waitFor(() => expect(screen.getByLabelText("Validierungsprotokolle").textContent).toBe(rawBuildLog));
    expect(screen.getByRole("button", { name: "Veröffentlichen" })).toBeDisabled();
  });

  it("shows stale publication API errors verbatim while keeping German controls", async () => {
    const staleError = "Revision revision-1 is stale; expected revision-2.";
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard, revisions: [passedRevision] });
    vi.mocked(publishCustomDashboardRevision).mockRejectedValue(new Error(staleError));

    renderPage(projectContext, "de");
    const publishButton = await screen.findByRole("button", { name: "Veröffentlichen" });
    expect(publishButton).toBeEnabled();
    fireEvent.click(publishButton);

    expect(await screen.findByText(staleError)).toBeInTheDocument();
    expect(screen.queryByText(/Revision revision-1 ist veraltet/)).not.toBeInTheDocument();
  });
});
