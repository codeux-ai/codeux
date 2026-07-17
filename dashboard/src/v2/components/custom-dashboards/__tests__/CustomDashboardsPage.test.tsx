/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardLocale } from "../../../i18n/locales.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import { CustomDashboardsPage } from "../../../CustomDashboardsPage.js";
import { ProjectDataContext } from "../../../context/project-data.js";
import type {
  AutomationCredentialMetadata,
  CredentialBackendHealth,
} from "../../../../../../src/contracts/automation-credential-types.js";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
} from "../../../types.js";
import {
  archiveCustomDashboard,
  bindCustomDashboardCredential,
  createCustomDashboard,
  createCustomDashboardRevision,
  fetchCustomDashboard,
  fetchCustomDashboardCredentialBindings,
  fetchCustomDashboardDataCatalog,
  fetchCustomDashboardValidationLogs,
  fetchCustomDashboardValidationSession,
  fetchCustomDashboards,
  publishCustomDashboardRevision,
  startCustomDashboardValidation,
  unbindCustomDashboardCredential,
  updateCustomDashboardDraft,
  CustomDashboardCredentialBindingApiError,
  type CustomDashboardCredentialBindingReview,
} from "../../../lib/custom-dashboard-api.js";
import {
  fetchAutomationCredentials,
  fetchCredentialHealth,
} from "../../../lib/automation-credential-api.js";

vi.mock("../../../lib/custom-dashboard-api.js", () => ({
  archiveCustomDashboard: vi.fn(),
  bindCustomDashboardCredential: vi.fn(),
  createCustomDashboard: vi.fn(),
  createCustomDashboardRevision: vi.fn(),
  fetchCustomDashboard: vi.fn(),
  fetchCustomDashboardCredentialBindings: vi.fn(),
  fetchCustomDashboardDataCatalog: vi.fn(),
  fetchCustomDashboardValidationLogs: vi.fn(),
  fetchCustomDashboardValidationSession: vi.fn(),
  fetchCustomDashboards: vi.fn(),
  publishCustomDashboardRevision: vi.fn(),
  startCustomDashboardValidation: vi.fn(),
  unbindCustomDashboardCredential: vi.fn(),
  updateCustomDashboardDraft: vi.fn(),
  CustomDashboardCredentialBindingApiError: class CustomDashboardCredentialBindingApiError extends Error {
    constructor(readonly status: number, message: string, readonly issues: unknown[] = []) {
      super(message);
      this.name = "CustomDashboardCredentialBindingApiError";
    }
  },
}));

vi.mock("../../../lib/automation-credential-api.js", () => ({
  fetchAutomationCredentials: vi.fn(),
  fetchCredentialHealth: vi.fn(),
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
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
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

vi.mock("../CustomDashboardValidationPanel.js", async () => {
  const { h: createElement } = await vi.importActual<typeof import("preact")>("preact");
  return {
    CustomDashboardValidationPanel: ({
      selectedRevision,
      validationSession,
      logs,
      pollingState,
      pollingError,
      validationAnnouncement,
      onStartValidation,
      onRetryPoll,
      onPublish,
    }: any) => {
    const canPublish = Boolean(
      selectedRevision?.validationStatus === "passed"
        || (validationSession?.status === "passed" && validationSession.revisionId === selectedRevision?.id),
    );
    return createElement(
      "aside",
      { "aria-label": "Custom dashboard validation and publication" },
      createElement("button", { type: "button", onClick: onStartValidation }, "Validate"),
      createElement("button", { type: "button", disabled: !canPublish, onClick: onPublish }, "Publish"),
      createElement("div", { "data-testid": "polling-state", "data-state": pollingState }, pollingError || pollingState),
      createElement("div", { "data-testid": "validation-announcement" }, validationAnnouncement),
      pollingState === "stale" || pollingState === "failed"
        ? createElement("button", { type: "button", onClick: onRetryPoll }, "Retry polling")
        : null,
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

const dashboardWithSlots: CustomDashboardRecord = {
  ...dashboard,
  manifest: {
    ...dashboard.manifest,
    credentialSlots: [
      {
        slotId: "deploy_api",
        label: "Deployment API",
        phase: "runtime",
        required: true,
        allowedKinds: ["api_token"],
        requiredCapabilities: ["read", "write"],
      },
      {
        slotId: "build_registry",
        label: "Build registry",
        phase: "build",
        required: false,
        allowedKinds: ["registry_token"],
        requiredCapabilities: ["read"],
      },
    ],
  },
};

const secondDashboard: CustomDashboardRecord = {
  ...dashboard,
  id: "dashboard-2",
  title: "Operations Radar",
  description: "Operational health",
};

const credential = (
  id: string,
  name: string,
  kind: string,
  capabilities: string[],
  patch: Partial<AutomationCredentialMetadata> = {},
): AutomationCredentialMetadata => ({
  id,
  name,
  kind,
  scope: "project",
  projectId: "project-1",
  managementProjectId: "project-1",
  allowedProjectIds: [],
  capabilities,
  status: "active",
  configured: true,
  keyId: "local-key",
  keyVersion: 1,
  version: 1,
  lastValidatedAt: null,
  validationStatus: "valid",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...patch,
});

const compatibleCredential = credential("credential-compatible", "Compatible Key", "api_token", ["read", "write"]);
const replacementCredential = credential("credential-replacement", "Replacement Key", "api_token", ["read", "write", "admin"]);
const wrongKindCredential = credential("credential-wrong-kind", "Wrong Kind", "password", ["read", "write"]);
const missingCapabilityCredential = credential("credential-read-only", "Read Only", "api_token", ["read"]);
const inactiveCredential = credential("credential-inactive", "Inactive Key", "api_token", ["read", "write"], { status: "revoked" });

const readyHealth: CredentialBackendHealth = {
  available: true,
  secure: true,
  provider: "local",
  keyId: "local-key",
  keyVersion: 1,
};

const slotReview = (
  bindingCredential: AutomationCredentialMetadata | null = null,
  revisionNumber = 1,
): CustomDashboardCredentialBindingReview => {
  const candidates = [
    { credential: compatibleCredential, compatible: true, issues: [] as const, missingCapabilities: [] },
    { credential: replacementCredential, compatible: true, issues: [] as const, missingCapabilities: [] },
    { credential: wrongKindCredential, compatible: false, issues: ["kind_not_allowed"] as const, missingCapabilities: [] },
    { credential: missingCapabilityCredential, compatible: false, issues: ["capability_missing"] as const, missingCapabilities: ["write"] },
    { credential: inactiveCredential, compatible: false, issues: ["not_active"] as const, missingCapabilities: [] },
  ].map(({ credential: candidate, compatible, issues, missingCapabilities }) => ({
    credentialId: candidate.id,
    metadata: candidate,
    compatible,
    issues: [...issues],
    missingCapabilities,
  }));
  const requiredIssue = bindingCredential ? [] : [{
    field: "credentialBindings.deploy_api",
    code: "required_binding_missing",
    message: "Deployment API requires a credential binding.",
  }];
  return {
    projectId: "project-1",
    dashboardId: "dashboard-1",
    revisionId: null,
    credentialBindingRevision: revisionNumber,
    backend: readyHealth,
    valid: requiredIssue.length === 0,
    issues: requiredIssue,
    slots: [
      {
        slot: dashboardWithSlots.manifest.credentialSlots![0]!,
        binding: bindingCredential ? { slotId: "deploy_api", credentialId: bindingCredential.id } : null,
        metadata: bindingCredential,
        compatible: Boolean(bindingCredential),
        issues: requiredIssue,
        candidates,
      },
      {
        slot: dashboardWithSlots.manifest.credentialSlots![1]!,
        binding: null,
        metadata: null,
        compatible: true,
        issues: [],
        candidates: [],
      },
    ],
    credentialCandidateCount: candidates.length,
    credentialCandidatesTruncated: false,
  };
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

const runningSession: CustomDashboardValidationSessionRecord = {
  ...passedSession,
  status: "running",
  validationReport: null,
  finishedAt: null,
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

const openCredentialPanel = async () => {
  const tab = await screen.findByRole("tab", { name: "Credentials" });
  fireEvent.click(tab);
  return await screen.findByRole("region", { name: "Dashboard credential slots" });
};

describe("CustomDashboardsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [dashboard] });
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard, revisions: [revision] });
    vi.mocked(fetchCustomDashboardCredentialBindings).mockResolvedValue(slotReview());
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([
      compatibleCredential,
      replacementCredential,
      wrongKindCredential,
      missingCapabilityCredential,
      inactiveCredential,
    ]);
    vi.mocked(fetchCredentialHealth).mockResolvedValue(readyHealth);
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
    expect(screen.queryByRole("tab", { name: "Credentials" })).not.toBeInTheDocument();
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

  it("guards dirty dashboard changes with keep-editing and save-and-continue choices", async () => {
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [dashboard, secondDashboard] });
    vi.mocked(fetchCustomDashboard).mockImplementation(async (dashboardId) => ({
      dashboard: dashboardId === secondDashboard.id ? secondDashboard : dashboard,
      revisions: [revision],
    }));
    vi.mocked(updateCustomDashboardDraft).mockImplementation(async (_dashboardId, input) => ({
      ...dashboard,
      title: input.title ?? dashboard.title,
    }));
    renderPage();

    const title = await screen.findByLabelText("Title");
    fireEvent.input(title, { target: { value: "Edited delivery pulse" } });
    fireEvent.click(screen.getByRole("button", { name: "Operations Radar" }));

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/i }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(vi.mocked(fetchCustomDashboard).mock.calls.every(([dashboardId]) => dashboardId !== secondDashboard.id)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Operations Radar" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(updateCustomDashboardDraft).toHaveBeenCalledWith(
      dashboard.id,
      expect.objectContaining({ title: "Edited delivery pulse" }),
    ));
    await waitFor(() => expect(fetchCustomDashboard).toHaveBeenCalledWith(secondDashboard.id, expect.any(AbortSignal)));
  });

  it("preserves a dirty draft across project changes until discard is confirmed", async () => {
    const nextProject = { id: "project-2", name: "Second Test Project", status: "ready" };
    const context = {
      ...projectContext,
      projects: [...projectContext.projects, nextProject],
    };
    const rendered = renderPage(context);
    fireEvent.input(await screen.findByLabelText("Title"), { target: { value: "Project-local edit" } });

    rendered.rerender(
      <DashboardI18nProvider initialLocale="en" storage={null}>
        <ProjectDataContext.Provider value={{
          ...context,
          selectedProjectId: nextProject.id,
          selectedProject: nextProject,
        } as any}>
          <CustomDashboardsPage />
        </ProjectDataContext.Provider>
      </DashboardI18nProvider>,
    );

    expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Project-local edit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Discard without saving/i }));

    await waitFor(() => expect(fetchCustomDashboards).toHaveBeenCalledWith(nextProject.id, expect.any(AbortSignal)));
    expect(updateCustomDashboardDraft).not.toHaveBeenCalled();
  });

  it("does not open the viewer over a dirty editor without an explicit choice", async () => {
    renderPage();
    fireEvent.input(await screen.findByLabelText("Title"), { target: { value: "Unsaved viewer edit" } });

    fireEvent.click(screen.getByRole("button", { name: "Open Published" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Unsaved viewer edit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Discard without saving/i }));
    expect(await screen.findByText("Published viewer unavailable")).toBeInTheDocument();
    expect(updateCustomDashboardDraft).not.toHaveBeenCalled();
  });

  it("provides stable roving tabs and marks reduced-motion-safe panel changes", async () => {
    renderPage();

    const manifestTab = await screen.findByRole("tab", { name: "Manifest" });
    const filesTab = screen.getByRole("tab", { name: "Files" });
    expect(manifestTab).toHaveAttribute("id", "custom-dashboard-editor-tab-manifest");
    expect(manifestTab).toHaveAttribute("aria-controls", "custom-dashboard-editor-panel-manifest");
    expect(manifestTab).toHaveAttribute("tabindex", "0");
    expect(filesTab).toHaveAttribute("tabindex", "-1");

    manifestTab.focus();
    fireEvent.keyDown(manifestTab, { key: "ArrowRight" });
    await waitFor(() => expect(filesTab).toHaveFocus());
    expect(filesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "custom-dashboard-editor-tab-files");
    expect(screen.getByRole("tabpanel")).toHaveClass("motion-reduce:transition-none");

    fireEvent.keyDown(filesTab, { key: "End" });
    const catalogTab = screen.getByRole("tab", { name: "Catalog" });
    await waitFor(() => expect(catalogTab).toHaveFocus());
    fireEvent.keyDown(catalogTab, { key: "Home" });
    await waitFor(() => expect(manifestTab).toHaveFocus());
  });

  it("validates JSON on blur, identifies its tab, and focuses the invalid editor on save", async () => {
    renderPage();

    const manifestEditor = await screen.findByLabelText("Manifest JSON");
    manifestEditor.focus();
    fireEvent.input(manifestEditor, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));

    const invalidTab = await screen.findByRole("tab", { name: "Manifest contains errors" });
    fireEvent.click(invalidTab);
    expect(await screen.findByRole("alert")).toHaveTextContent("Manifest contains invalid JSON");
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    const activeManifestEditor = await screen.findByRole("textbox", { name: /Manifest JSON/ });
    await waitFor(() => expect(activeManifestEditor).toHaveFocus());
    expect(updateCustomDashboardDraft).not.toHaveBeenCalled();
    expect(activeManifestEditor).toHaveValue("{");
  });

  it("keeps file removal draft-only and restores the file at its original position", async () => {
    const dashboardWithFiles: CustomDashboardRecord = {
      ...dashboard,
      manifest: {
        ...dashboard.manifest,
        filePaths: ["src/dashboard.tsx", "src/helper.ts"],
      },
      fileBundle: {
        files: [
          dashboard.fileBundle.files[0]!,
          { path: "src/helper.ts", content: "export const helper = true;" },
        ],
      },
    };
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithFiles, revisions: [revision] });
    renderPage();

    fireEvent.click(await screen.findByRole("tab", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const undo = await screen.findByRole("button", { name: "Undo removal" });
    await waitFor(() => expect(undo).toHaveFocus());
    expect(screen.queryByRole("button", { name: "src/dashboard.tsx" })).not.toBeInTheDocument();
    expect(updateCustomDashboardDraft).not.toHaveBeenCalled();

    fireEvent.click(undo);
    const fileButtons = screen.getAllByRole("button").filter((button) => (
      button.textContent === "src/dashboard.tsx" || button.textContent === "src/helper.ts"
    ));
    expect(fileButtons.map((button) => button.textContent)).toEqual(["src/dashboard.tsx", "src/helper.ts"]);
    expect(updateCustomDashboardDraft).not.toHaveBeenCalled();
  });

  it("keeps logs through polling failure and exposes an explicit recovering retry", async () => {
    const pollCallback = { current: null as (() => void) | null };
    const intervalSpy = vi.spyOn(window, "setInterval").mockImplementation((callback) => {
      pollCallback.current = callback as () => void;
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    vi.mocked(startCustomDashboardValidation).mockResolvedValue(runningSession);
    vi.mocked(fetchCustomDashboardValidationSession).mockRejectedValueOnce(new Error("temporary network loss"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Validate" }));
    expect(await screen.findByText(/build ok/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("polling-state")).toHaveAttribute("data-state", "active"));

    try {
      pollCallback.current?.();
      await waitFor(() => expect(screen.getByTestId("polling-state")).toHaveAttribute("data-state", "stale"));
    } finally {
      intervalSpy.mockRestore();
    }
    expect(screen.getByText("temporary network loss")).toBeInTheDocument();
    expect(screen.getByText(/build ok/i)).toBeInTheDocument();

    vi.mocked(fetchCustomDashboardValidationSession).mockResolvedValue(runningSession);
    vi.mocked(fetchCustomDashboardValidationLogs).mockResolvedValue({ logs: "build ok\nreconnected" });
    fireEvent.click(screen.getByRole("button", { name: "Retry polling" }));
    await waitFor(() => expect(screen.getByTestId("polling-state")).toHaveAttribute("data-state", "recovering"));
    expect(screen.getByText(/reconnected/i)).toBeInTheDocument();
  });

  it("ignores a stale poll result after selecting another dashboard", async () => {
    const resolvePoll = { current: null as ((session: CustomDashboardValidationSessionRecord) => void) | null };
    const pollCallback = { current: null as (() => void) | null };
    const intervalSpy = vi.spyOn(window, "setInterval").mockImplementation((callback) => {
      pollCallback.current = callback as () => void;
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    const stalePoll = new Promise<CustomDashboardValidationSessionRecord>((resolve) => {
      resolvePoll.current = resolve;
    });
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [dashboard, secondDashboard] });
    vi.mocked(fetchCustomDashboard).mockImplementation(async (dashboardId) => ({
      dashboard: dashboardId === secondDashboard.id ? secondDashboard : dashboard,
      revisions: [revision],
    }));
    vi.mocked(startCustomDashboardValidation).mockResolvedValue(runningSession);
    vi.mocked(fetchCustomDashboardValidationSession).mockReturnValue(stalePoll);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Validate" }));
    await waitFor(() => expect(screen.getByTestId("polling-state")).toHaveAttribute("data-state", "active"));
    pollCallback.current?.();
    await waitFor(() => expect(fetchCustomDashboardValidationSession).toHaveBeenCalledWith("session-1", expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("button", { name: "Operations Radar" }));
    await waitFor(() => expect(fetchCustomDashboard).toHaveBeenCalledWith(secondDashboard.id, expect.any(AbortSignal)));
    resolvePoll.current?.(passedSession);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByTestId("validation-announcement")).not.toHaveTextContent("Validated");
    intervalSpy.mockRestore();
  });

  it("keeps legacy dashboards without declared slots unchanged", async () => {
    renderPage();

    expect(await screen.findByText("Delivery Pulse")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Dashboard credential slots" })).not.toBeInTheDocument();
    expect(fetchCustomDashboardCredentialBindings).not.toHaveBeenCalled();
    expect(fetchAutomationCredentials).not.toHaveBeenCalled();
    expect(fetchCredentialHealth).not.toHaveBeenCalled();
  });

  it("renders required and optional slot declarations and filters credential choices by policy", async () => {
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithSlots, revisions: [revision] });
    renderPage();

    const panel = await openCredentialPanel();
    await screen.findByText("Deployment API");
    expect(panel).toHaveTextContent("Deployment API");
    expect(panel).toHaveTextContent("Runtime phase");
    expect(panel).toHaveTextContent("Required");
    expect(panel).toHaveTextContent("api_token");
    expect(panel).toHaveTextContent("read, write");
    expect(panel).toHaveTextContent("Build registry");
    expect(panel).toHaveTextContent("Build phase");
    expect(panel).toHaveTextContent("Optional");
    expect(panel).toHaveTextContent("need attention before the next revision is publication-ready");

    const select = screen.getByRole("button", { name: "Compatible credential for Deployment API" });
    fireEvent.click(select);
    expect(screen.getByRole("option", { name: /Compatible Key/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Replacement Key/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Wrong Kind/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Read Only/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Inactive Key/ })).not.toBeInTheDocument();
  });

  it("binds, replaces, and unbinds with the latest revision while restoring action focus", async () => {
    let currentReview = slotReview();
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithSlots, revisions: [revision] });
    vi.mocked(fetchCustomDashboardCredentialBindings).mockImplementation(async () => currentReview);
    vi.mocked(bindCustomDashboardCredential).mockImplementation(async (_projectId, _dashboardId, input) => {
      currentReview = slotReview(input.credentialId === replacementCredential.id ? replacementCredential : compatibleCredential, input.expectedBindingRevision + 1);
      return currentReview;
    });
    vi.mocked(unbindCustomDashboardCredential).mockImplementation(async (_projectId, _dashboardId, _slotId, expectedBindingRevision) => {
      currentReview = slotReview(null, expectedBindingRevision + 1);
      return currentReview;
    });
    renderPage();

    await openCredentialPanel();
    const select = await screen.findByRole("button", { name: "Compatible credential for Deployment API" });
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /Compatible Key/ }));
    expect(select).toHaveValue(compatibleCredential.id);
    const bindButton = screen.getByRole("button", { name: "Bind credential for Deployment API" });
    await waitFor(() => expect(bindButton).toBeEnabled());
    bindButton.focus();
    fireEvent.click(bindButton);
    await waitFor(() => expect(bindCustomDashboardCredential).toHaveBeenCalledWith(
      "project-1",
      "dashboard-1",
      { slotId: "deploy_api", credentialId: compatibleCredential.id, expectedBindingRevision: 1 },
      expect.any(AbortSignal),
    ));
    await screen.findByText("Compatible binding");
    await waitFor(() => expect([
      screen.getByRole("button", { name: "Compatible credential for Deployment API" }),
      screen.getByRole("button", { name: "Replace binding for Deployment API" }),
    ]).toContain(document.activeElement));

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: /Replacement Key/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace binding for Deployment API" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Replace binding for Deployment API" }));
    await waitFor(() => expect(bindCustomDashboardCredential).toHaveBeenLastCalledWith(
      "project-1",
      "dashboard-1",
      { slotId: "deploy_api", credentialId: replacementCredential.id, expectedBindingRevision: 2 },
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("Replacement Key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unbind credential for Deployment API" }));
    await waitFor(() => expect(unbindCustomDashboardCredential).toHaveBeenCalledWith(
      "project-1",
      "dashboard-1",
      "deploy_api",
      3,
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("Deployment API requires a credential binding.")).toBeInTheDocument();
    expect(screen.getByText(/need attention before the next revision is publication-ready/i)).toBeInTheDocument();
  });

  it("explains unavailable custody and links to credential Settings", async () => {
    const unavailableHealth: CredentialBackendHealth = {
      available: false,
      secure: false,
      provider: "unavailable",
      keyId: null,
      keyVersion: null,
      reason: "Local key custody is offline.",
    };
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithSlots, revisions: [revision] });
    vi.mocked(fetchCredentialHealth).mockResolvedValue(unavailableHealth);
    vi.mocked(fetchCustomDashboardCredentialBindings).mockResolvedValue({ ...slotReview(), backend: unavailableHealth });
    renderPage();

    await openCredentialPanel();
    expect(await screen.findByText("Secure credential custody is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Local key custody is offline.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Manage credentials in Settings" })[0]).toHaveAttribute("href", "/config");
    expect(screen.getByRole("button", { name: "Compatible credential for Deployment API" })).toBeDisabled();
  });

  it("cancels stale credential metadata requests when the selected dashboard changes", async () => {
    const secondDashboard = { ...dashboardWithSlots, id: "dashboard-2", title: "Second Dashboard" };
    const signals: AbortSignal[] = [];
    vi.mocked(fetchCustomDashboards).mockResolvedValue({ dashboards: [dashboardWithSlots, secondDashboard] });
    vi.mocked(fetchCustomDashboard).mockImplementation(async (dashboardId) => ({
      dashboard: dashboardId === secondDashboard.id ? secondDashboard : dashboardWithSlots,
      revisions: [revision],
    }));
    vi.mocked(fetchCustomDashboardCredentialBindings).mockImplementation(async (_projectId, dashboardId, signal) => {
      if (signal) signals.push(signal);
      return { ...slotReview(), dashboardId };
    });
    renderPage();

    await screen.findByRole("tab", { name: "Credentials" });
    fireEvent.click(screen.getByRole("button", { name: "Second Dashboard" }));

    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals.at(-1)?.aborted).toBe(false);
  });

  it("refreshes on optimistic conflict and requires an explicit retry with the new revision", async () => {
    let currentReview = slotReview();
    let attempts = 0;
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithSlots, revisions: [revision] });
    vi.mocked(fetchCustomDashboardCredentialBindings).mockImplementation(async () => currentReview);
    vi.mocked(bindCustomDashboardCredential).mockImplementation(async (_projectId, _dashboardId, input) => {
      attempts += 1;
      if (attempts === 1) {
        currentReview = slotReview(replacementCredential, 2);
        throw new CustomDashboardCredentialBindingApiError(409, "Bindings changed concurrently.");
      }
      currentReview = slotReview(compatibleCredential, input.expectedBindingRevision + 1);
      return currentReview;
    });
    renderPage();

    await openCredentialPanel();
    const select = await screen.findByRole("button", { name: "Compatible credential for Deployment API" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: /Compatible Key/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bind credential for Deployment API" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Bind credential for Deployment API" }));

    expect(await screen.findByText(/dashboard was refreshed; review the current binding and explicitly retry/i)).toBeInTheDocument();
    expect(screen.getByText("Replacement Key")).toBeInTheDocument();
    expect(bindCustomDashboardCredential).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Replace binding for Deployment API" }));
    await waitFor(() => expect(bindCustomDashboardCredential).toHaveBeenLastCalledWith(
      "project-1",
      "dashboard-1",
      { slotId: "deploy_api", credentialId: compatibleCredential.id, expectedBindingRevision: 2 },
      expect.any(AbortSignal),
    ));
  });

  it("surfaces policy denial on the affected slot and clears stale validation readiness after a save", async () => {
    let currentReview = slotReview();
    let deny = true;
    vi.mocked(fetchCustomDashboard).mockResolvedValue({ dashboard: dashboardWithSlots, revisions: [revision] });
    vi.mocked(fetchCustomDashboardCredentialBindings).mockImplementation(async () => currentReview);
    vi.mocked(bindCustomDashboardCredential).mockImplementation(async (_projectId, _dashboardId, input) => {
      if (deny) {
        deny = false;
        throw new CustomDashboardCredentialBindingApiError(403, "Credential capability policy denied this binding.");
      }
      currentReview = slotReview(compatibleCredential, input.expectedBindingRevision + 1);
      return currentReview;
    });
    renderPage();

    await openCredentialPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Validate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled());
    const select = screen.getByRole("button", { name: "Compatible credential for Deployment API" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: /Compatible Key/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bind credential for Deployment API" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Bind credential for Deployment API" }));
    expect(await screen.findByText("Credential capability policy denied this binding.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();

    const detailRefreshesBeforeSave = vi.mocked(fetchCustomDashboard).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Bind credential for Deployment API" }));
    await screen.findByText(/Credential binding saved. Validation and publication readiness were refreshed./i);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(vi.mocked(fetchCustomDashboard).mock.calls.length).toBeGreaterThan(detailRefreshesBeforeSave);
  });
});
