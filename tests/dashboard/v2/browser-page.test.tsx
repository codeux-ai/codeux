// @vitest-environment jsdom
/** @jsx h */
import { h, type ComponentChildren } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserPage } from "../../../dashboard/src/v2/BrowserPage.js";
import { usePreviewSessions } from "../../../dashboard/src/v2/hooks/use-preview-sessions.js";
import { fetchPreviewLogs, fetchPreviewScript, savePreviewScript } from "../../../dashboard/src/v2/lib/browser-api.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  ProjectDataContext: {},
  useProjectData: vi.fn(() => ({
    selectedProject: { id: "p1", name: "Project 1" },
  })),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(() => ({
    data: [{ id: "s1", name: "Sprint 1" }, { id: "s2", name: "Sprint 2" }, { id: "s3", name: "Sprint 3" }],
    selectedSprint: { id: "s1", name: "Sprint 1" },
    selectedSprintId: "s1",
  })),
}));

const mockRefreshSessions = vi.fn().mockResolvedValue(undefined);
const { mockStartPreviewSession, mockRemovePreviewSession } = vi.hoisted(() => ({
  mockStartPreviewSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
  mockRemovePreviewSession: vi.fn().mockResolvedValue(undefined),
}));

const buildDefaultPreviewSessionsResult = () => ({
  sessions: [
    {
      id: "sess-1",
      projectId: "p1",
      sprintId: "s1",
      sprintName: "Sprint 1",
      status: "running" as const,
      healthStatus: "healthy" as const,
      containerAppPort: 3000,
      hostPort: 8080,
      portMappings: [{ containerPort: 3000, hostPort: 8080, isPrimary: true }],
    },
    {
      id: "sess-2",
      projectId: "p1",
      sprintId: "s2",
      sprintName: "Sprint 2",
      status: "stopped" as const,
      healthStatus: "unknown" as const,
      containerAppPort: 3000,
      hostPort: null,
      portMappings: [{ containerPort: 3000, hostPort: null, isPrimary: true }],
    },
  ],
  selectedSession: {
    id: "sess-1",
    projectId: "p1",
    sprintId: "s1",
    sprintName: "Sprint 1",
    status: "running" as const,
    healthStatus: "healthy" as const,
    containerAppPort: 3000,
    hostPort: 8080,
    portMappings: [{ containerPort: 3000, hostPort: 8080, isPrimary: true }],
  },
  loading: false,
  error: null,
  refresh: mockRefreshSessions,
});

vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
  usePreviewSessions: vi.fn(() => buildDefaultPreviewSessionsResult()),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(() => ({
    data: {
      settings: {
        sprintPreview: {
          enabled: true,
          showInAppBrowser: true,
        },
      },
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../dashboard/src/v2/components/browser/PreviewSessionSlider.js", () => ({
  PreviewSessionSlider: ({
    sessions,
    onSelectSession,
    onRemoveSession,
    removingSessionIds = [],
  }: {
    sessions: Array<{ id: string; sprintName: string; hostPort?: number | null }>;
    onSelectSession: (id: string) => void;
    onRemoveSession: (id: string) => void;
    removingSessionIds?: string[];
  }) => (
    <div>
      {sessions.filter((session) => !removingSessionIds.includes(session.id)).map((session) => (
        <div key={session.id}>
          <button type="button" onClick={() => onSelectSession(session.id)}>{session.sprintName}</button>
          <button type="button" onClick={() => onRemoveSession(session.id)}>Remove</button>
          <a href={session.hostPort ? `http://preview-${session.id}.localhost` : undefined}>Open Link</a>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../../../dashboard/src/v2/components/browser/PreviewWindowChrome.js", () => ({
  PreviewWindowChrome: ({
    addressValue,
    onAddressChange,
    onAddressSubmit,
    onReload,
    navigationEnabled = true,
    navigationBusy = false,
    navigationDisabledReason,
    portMappings = [],
    selectedContainerPort,
    onSelectPort,
    children,
  }: {
    addressValue: string;
    onAddressChange: (value: string) => void;
    onAddressSubmit: (value: string) => void;
    onReload: () => void;
    navigationEnabled?: boolean;
    navigationBusy?: boolean;
    navigationDisabledReason?: string;
    portMappings?: Array<{ containerPort: number; hostPort: number | null; label?: string }>;
    selectedContainerPort?: number | null;
    onSelectPort?: (containerPort: number) => void;
    children: ComponentChildren;
  }) => (
    <div>
      {portMappings.length > 1 ? (
        <div role="tablist" aria-label="Preview ports">
          {portMappings.map((mapping) => (
            <button
              key={mapping.containerPort}
              type="button"
              role="tab"
              aria-selected={mapping.containerPort === selectedContainerPort}
              onClick={() => onSelectPort?.(mapping.containerPort)}
            >
              {mapping.label ? `${mapping.label} :${mapping.containerPort}` : `:${mapping.containerPort}`}
            </button>
          ))}
        </div>
      ) : null}
      <input
        aria-label="Preview address"
        value={addressValue}
        disabled={!navigationEnabled || navigationBusy}
        onInput={(event) => onAddressChange((event.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" disabled={!navigationEnabled || navigationBusy} aria-busy={navigationBusy} onClick={() => onReload()}>
        Reload preview
      </button>
      <button type="button" disabled={!navigationEnabled || navigationBusy} onClick={() => onAddressSubmit(addressValue)}>
        Navigate preview
      </button>
      {(!navigationEnabled || navigationBusy) && navigationDisabledReason ? (
        <div role="status">{navigationDisabledReason}</div>
      ) : null}
      {children}
    </div>
  ),
}));

vi.mock("../../../dashboard/src/v2/components/browser/LaunchContainerPanel.js", () => ({
  LaunchContainerPanel: ({
    sprints,
    launchSprintId,
    onLaunchSprintChange,
    onLaunchContainer,
    launchEnabled,
    launchBusy,
  }: {
    sprints: Array<{ id: string; name: string }>;
    launchSprintId: string;
    onLaunchSprintChange: (value: string) => void;
    onLaunchContainer: () => void;
    launchEnabled: boolean;
    launchBusy: boolean;
  }) => (
    <div>
      <div>Launch Container</div>
      <select value={launchSprintId} onChange={(event) => onLaunchSprintChange((event.currentTarget as HTMLSelectElement).value)}>
        {sprints.map((sprint) => (
          <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
        ))}
      </select>
      <button type="button" disabled={!launchEnabled || launchBusy || !launchSprintId} onClick={() => onLaunchContainer()}>
        Launch Container
      </button>
    </div>
  ),
}));

vi.mock("../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js", () => ({
  ActionFeedbackRegion: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
  fetchPreviewLogs: vi.fn().mockResolvedValue({ logs: "mock logs" }),
  fetchPreviewScript: vi.fn().mockResolvedValue({ content: "mock script", mode: "script", path: "/script.sh" }),
  removePreviewSession: mockRemovePreviewSession,
  rebuildPreviewSession: vi.fn().mockResolvedValue(undefined),
  savePreviewScript: vi.fn().mockResolvedValue({ content: "new mock script", mode: "script", path: "/script.sh" }),
  startPreviewSession: mockStartPreviewSession,
  stopPreviewSession: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  vi.mocked(usePreviewSessions).mockReset();
  vi.mocked(usePreviewSessions).mockImplementation(() => buildDefaultPreviewSessionsResult());
});

describe("BrowserPage", () => {

  it("shows loading state overlay when navigation is disabled", async () => {
    vi.mocked(usePreviewSessions).mockImplementation(() => ({
      sessions: [
        {
          id: "sess-starting",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint Starting",
          status: "starting",
          healthStatus: "unknown",
          containerAppPort: 3000,
          hostPort: null,
        } as any,
      ],
      selectedSession: {
        id: "sess-starting",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint Starting",
        status: "starting",
        healthStatus: "unknown",
        containerAppPort: 3000,
        hostPort: null,
      } as any,
      loading: false,
      error: null,
      refresh: mockRefreshSessions,
    }));

    render(<BrowserPage />);

    expect(screen.getByText("Container starting...")).toBeInTheDocument();
  });

  it("shows loading state overlay when session is stopped", async () => {
    vi.mocked(usePreviewSessions).mockImplementation(() => ({
      sessions: [
        {
          id: "sess-stopped",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint Stopped",
          status: "stopped",
          healthStatus: "unknown",
          containerAppPort: 3000,
          hostPort: null,
        } as any,
      ],
      selectedSession: {
        id: "sess-stopped",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint Stopped",
        status: "stopped",
        healthStatus: "unknown",
        containerAppPort: 3000,
        hostPort: null,
      } as any,
      loading: false,
      error: null,
      refresh: mockRefreshSessions,
    }));

    render(<BrowserPage />);

    expect(screen.getByText("Waiting for connection...")).toBeInTheDocument();
  });

  afterEach(() => {
    mockStartPreviewSession.mockClear();
    mockRemovePreviewSession.mockClear();
    mockRefreshSessions.mockClear();
    vi.mocked(fetchPreviewLogs).mockReset();
    vi.mocked(fetchPreviewLogs).mockResolvedValue({ logs: "mock logs" });
    vi.mocked(fetchPreviewScript).mockReset();
    vi.mocked(fetchPreviewScript).mockResolvedValue({ content: "mock script", mode: "script", path: "/script.sh" });
    vi.mocked(savePreviewScript).mockReset();
    vi.mocked(savePreviewScript).mockResolvedValue({ content: "new mock script", mode: "script", path: "/script.sh" });
  });

  it("renders correctly with new slider and chrome components", async () => {
    let container!: HTMLElement;
    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    expect(screen.getByText("Build previews per sprint, isolated by container")).toBeInTheDocument();
    const pageRoot = screen.getByTestId("browser-page-root");
    expect(pageRoot.className).toContain("px-4");
    expect(pageRoot.className).toContain("py-10");
    expect(pageRoot.className).toContain("md:px-8");
    expect(screen.getByTestId("browser-page-header")).toBeInTheDocument();
    const mainPanel = screen.getByTestId("browser-main-tool-panel");
    expect(mainPanel).toBeInTheDocument();
    expect(mainPanel.className).toContain("grid-cols-1");
    expect(mainPanel.className).toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
    expect(screen.getAllByText("Sprint 2").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected Sprint")).toBeInTheDocument();
    expect(screen.getAllByText("Launch Container").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open Link").length).toBeGreaterThan(0);

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    const selectedSprintLabel = screen.getByText("Selected Sprint");
    expect((iframe?.compareDocumentPosition(selectedSprintLabel) || 0) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    expect(container.innerHTML).not.toContain("#f5f1e8");
    expect(container.innerHTML).not.toContain("#f7f3ea");
    expect(screen.getByText("Port routing").parentElement?.className).toContain("bg-sky-500/10");
    expect(screen.getByText("Script path").parentElement?.className).toContain("bg-ember-500/10");
  });

  it("loads the preview script only when the editor is opened", async () => {
    render(<BrowserPage />);

    expect(vi.mocked(fetchPreviewScript)).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show startup script editor" }));
    });

    expect(vi.mocked(fetchPreviewScript)).toHaveBeenCalledWith("p1", "s1");
  });

  it("shows log loading feedback without hiding stale preview content", async () => {
    vi.useFakeTimers();
    try {
      render(<BrowserPage />);

      expect(screen.getByText("Loading logs...")).toBeInTheDocument();
      expect(screen.getAllByText("Loading preview logs.").length).toBeGreaterThan(0);
      expect(screen.getByTitle("Preview: Project 1 - Sprint 1 on port 3000")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Preview container logs")).toHaveTextContent("mock logs");
      });
      expect(vi.mocked(fetchPreviewLogs)).toHaveBeenCalledWith("sess-1", 160);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stale logs visible when a polling refresh returns no new content", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchPreviewLogs)
      .mockResolvedValueOnce({ logs: "first useful log line" })
      .mockResolvedValueOnce({ logs: "" });

    try {
      render(<BrowserPage />);

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Preview container logs")).toHaveTextContent("first useful log line");
      });

      await act(async () => {
        vi.advanceTimersByTime(8000);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Preview container logs")).toHaveTextContent("first useful log line");
      });
      expect(screen.getAllByText("Showing last available preview logs. New logs are pending.").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stale logs visible when a polling refresh fails", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchPreviewLogs)
      .mockResolvedValueOnce({ logs: "last useful log line" })
      .mockRejectedValueOnce(new Error("container unavailable"));

    try {
      render(<BrowserPage />);

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Preview container logs")).toHaveTextContent("last useful log line");
      });

      await act(async () => {
        vi.advanceTimersByTime(8000);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Preview container logs")).toHaveTextContent("last useful log line");
      });
      expect(screen.getAllByText("Preview logs could not be refreshed: container unavailable. Showing last available logs.").length).toBeGreaterThan(0);
      expect(screen.getByText("Error")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses duplicate reload navigation while navigation is pending", async () => {
    vi.useFakeTimers();
    try {
      render(<BrowserPage />);

      const reloadButton = screen.getByRole("button", { name: "Reload preview" });
      fireEvent.click(reloadButton);
      fireEvent.click(reloadButton);

      expect(screen.getByText("Reloading / in Sprint 1...")).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Reload preview" })).toBeDisabled();
      });

      await act(async () => {
        vi.advanceTimersByTime(360);
        await Promise.resolve();
      });

      expect(screen.getByText("Reload sent for /")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears delayed navigation success timers on unmount", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const getLastNavigationSuccessTimerId = () => {
      const timerIndex = setTimeoutSpy.mock.calls.reduce(
        (lastMatch, call, index) => (call[1] === 360 ? index : lastMatch),
        -1
      );
      return timerIndex >= 0 ? setTimeoutSpy.mock.results[timerIndex]?.value : undefined;
    };

    try {
      const reloadRender = render(<BrowserPage />);
      fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
      const reloadSuccessTimerId = getLastNavigationSuccessTimerId();

      reloadRender.unmount();

      expect(reloadSuccessTimerId).toBeDefined();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(reloadSuccessTimerId);

      setTimeoutSpy.mockClear();
      clearTimeoutSpy.mockClear();

      const navigateRender = render(<BrowserPage />);
      fireEvent.input(screen.getByLabelText("Preview address"), { target: { value: "/docs" } });
      fireEvent.click(screen.getByRole("button", { name: "Navigate preview" }));
      const addressSuccessTimerId = getLastNavigationSuccessTimerId();

      navigateRender.unmount();

      expect(addressSuccessTimerId).toBeDefined();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(addressSuccessTimerId);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows script save success feedback and prevents duplicate save submissions", async () => {
    const user = userEvent.setup();
    let resolveSave: ((value: { content: string; mode: "script"; path: string }) => void) | null = null;
    vi.mocked(savePreviewScript).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    render(<BrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show startup script editor" }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Startup script contents")).toHaveValue("mock script");
    });

    const saveButton = screen.getByRole("button", { name: "Save startup script" });
    await user.click(saveButton);
    await user.click(saveButton);

    expect(vi.mocked(savePreviewScript)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving startup script" })).toBeDisabled();
    expect(screen.getByText("Saving startup script. Editing is paused until the save completes.")).toBeInTheDocument();

    await act(async () => {
      resolveSave?.({ content: "new mock script", mode: "script", path: "/script.sh" });
      await Promise.resolve();
    });

    expect(screen.getByText("Script saved successfully")).toBeInTheDocument();
  });

  it("shows script save error feedback and keeps the editor available for recovery", async () => {
    const user = userEvent.setup();
    vi.mocked(savePreviewScript).mockRejectedValueOnce(new Error("disk full"));

    render(<BrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show startup script editor" }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Startup script contents")).toHaveValue("mock script");
    });

    await user.click(screen.getByRole("button", { name: "Save startup script" }));

    await waitFor(() => {
      expect(vi.mocked(savePreviewScript)).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to save script: disk full")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Startup script contents")).toBeEnabled();
  });

  it("does not hard-rebind the iframe src on in-app navigation updates", async () => {
    let container!: HTMLElement;
    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    const initialSrc = iframe?.getAttribute("src");
    const previewOrigin = initialSrc ? new URL(initialSrc).origin : "http://preview-sess-1.localhost";

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: previewOrigin,
        data: {
          type: "sprint-preview:state",
          path: "/sprints",
        },
      }));
    });

    expect((container.querySelector("iframe"))?.getAttribute("src")).toBe(initialSrc);
    expect(screen.getByDisplayValue("/sprints")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "sprints" })).not.toBeInTheDocument();
  });

  it("defaults multi-port sessions to the primary mapping and switches iframe URLs for secondary ports", async () => {
    let container!: HTMLElement;
    vi.mocked(usePreviewSessions).mockImplementation(() => ({
      sessions: [
        {
          id: "sess-multi",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint Multi",
          status: "running",
          healthStatus: "healthy",
          containerAppPort: 3000,
          hostPort: 8080,
          portMappings: [
            { containerPort: 3000, hostPort: 8080, isPrimary: true },
            { containerPort: 5173, hostPort: 8081, label: "Vite" },
          ],
          lastKnownPath: "/primary",
        } as any,
      ],
      selectedSession: {
        id: "sess-multi",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint Multi",
        status: "running",
        healthStatus: "healthy",
        containerAppPort: 3000,
        hostPort: 8080,
        portMappings: [
          { containerPort: 3000, hostPort: 8080, isPrimary: true },
          { containerPort: 5173, hostPort: 8081, label: "Vite" },
        ],
        lastKnownPath: "/primary",
      } as any,
      loading: false,
      error: null,
      refresh: mockRefreshSessions,
    }));

    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    const iframe = () => container.querySelector("iframe");
    const { protocol, port } = new URL(window.location.origin);
    const previewOrigin = `${protocol}//preview-sess-multi.localhost${port ? `:${port}` : ""}`;
    expect(screen.getByRole("tab", { name: ":3000" })).toHaveAttribute("aria-selected", "true");
    expect(iframe()?.getAttribute("src")).toBe(`${previewOrigin}/primary`);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Vite :5173" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Vite :5173" })).toHaveAttribute("aria-selected", "true");
      expect(iframe()?.getAttribute("src")).toBe(`${previewOrigin}/?containerPort=5173`);
    });
    expect(screen.getByTitle("Preview: Project 1 - Sprint Multi on port 5173")).toBeInTheDocument();
  });

  it("preserves current paths separately while switching selected preview ports", async () => {
    let container!: HTMLElement;
    vi.mocked(usePreviewSessions).mockImplementation(() => ({
      sessions: [
        {
          id: "sess-multi-paths",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint Multi Paths",
          status: "running",
          healthStatus: "healthy",
          containerAppPort: 3000,
          hostPort: 8080,
          portMappings: [
            { containerPort: 3000, hostPort: 8080, isPrimary: true },
            { containerPort: 6006, hostPort: 8082, label: "Storybook" },
          ],
          lastKnownPath: "/app",
        } as any,
      ],
      selectedSession: {
        id: "sess-multi-paths",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint Multi Paths",
        status: "running",
        healthStatus: "healthy",
        containerAppPort: 3000,
        hostPort: 8080,
        portMappings: [
          { containerPort: 3000, hostPort: 8080, isPrimary: true },
          { containerPort: 6006, hostPort: 8082, label: "Storybook" },
        ],
        lastKnownPath: "/app",
      } as any,
      loading: false,
      error: null,
      refresh: mockRefreshSessions,
    }));

    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    const iframe = () => container.querySelector("iframe");
    const { protocol, port } = new URL(window.location.origin);
    const previewOrigin = `${protocol}//preview-sess-multi-paths.localhost${port ? `:${port}` : ""}`;
    const address = screen.getByLabelText("Preview address");
    fireEvent.input(address, { target: { value: "/settings" } });
    fireEvent.click(screen.getByRole("button", { name: "Navigate preview" }));

    expect(iframe()?.getAttribute("src")).toBe(`${previewOrigin}/app`);
    expect(screen.getByDisplayValue("/settings")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Storybook :6006" }));
    });
    await waitFor(() => {
      expect(iframe()?.getAttribute("src")).toBe(`${previewOrigin}/?containerPort=6006`);
    });

    fireEvent.input(screen.getByLabelText("Preview address"), { target: { value: "/iframe.html" } });
    fireEvent.click(screen.getByRole("button", { name: "Navigate preview" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: ":3000" }));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("/settings")).toBeInTheDocument();
      expect(iframe()?.getAttribute("src")).toBe(`${previewOrigin}/settings`);
    });
  });

  it("keeps the preview iframe mounted for unavailable sessions and disables browser controls", async () => {
    vi.mocked(usePreviewSessions).mockImplementation(() => ({
      sessions: [
        {
          id: "sess-2",
          projectId: "p1",
          sprintId: "s2",
          sprintName: "Sprint 2",
          status: "stopped",
          healthStatus: "unknown",
          containerAppPort: 3000,
          hostPort: null,
        } as any,
      ],
      selectedSession: {
        id: "sess-2",
        projectId: "p1",
        sprintId: "s2",
        sprintName: "Sprint 2",
        status: "stopped",
        healthStatus: "unknown",
        containerAppPort: 3000,
        hostPort: null,
      } as any,
      loading: false,
      error: null,
      refresh: mockRefreshSessions,
    }));

    render(<BrowserPage />);

    const iframe = screen.getByTitle("Preview: Project 1 - Sprint 2 on port 3000");
    const { protocol, port } = new URL(window.location.origin);
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", `${protocol}//preview-sess-2.localhost${port ? `:${port}` : ""}/`);
    expect(screen.getByDisplayValue("/")).toBeDisabled();
    expect(screen.getAllByText("Preview navigation is disabled because the selected container is stopped. Start or rebuild the container to navigate.").length).toBeGreaterThan(0);
  });

  it("launches a container from the placeholder card for any sprint", async () => {
    const user = userEvent.setup();
    render(<BrowserPage />);

    const combobox = screen.getByRole("combobox");
    await user.selectOptions(combobox, "s3");

    const button = screen.getByRole("button", { name: "Launch Container" });
    await user.click(button);

    expect(mockStartPreviewSession).toHaveBeenCalledWith("p1", "s3");
    expect(mockRefreshSessions).toHaveBeenCalled();
    expect(screen.getByText("Container launched successfully")).toBeInTheDocument();
  });

  it("removes a preview session from the session card", async () => {
    render(<BrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    });

    expect(mockRemovePreviewSession).toHaveBeenCalledWith("sess-1");
    expect(mockRefreshSessions).toHaveBeenCalled();
  });

  it("removes the session card immediately while deletion is in flight", async () => {
    let resolveRemoval: (() => void) | null = null;
    mockRemovePreviewSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRemoval = resolve;
        })
    );

    render(<BrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    });

    await act(async () => {
      resolveRemoval?.();
    });

    expect(mockRemovePreviewSession).toHaveBeenCalledWith("sess-1");
  });
});
