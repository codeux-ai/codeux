// @vitest-environment jsdom
/** @jsx h */
import { h, type ComponentChildren } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserPage } from "../../../dashboard/src/v2/BrowserPage.js";
import { usePreviewSessions } from "../../../dashboard/src/v2/hooks/use-preview-sessions.js";
import { fetchPreviewScript } from "../../../dashboard/src/v2/lib/browser-api.js";

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
  }: {
    sessions: Array<{ id: string; sprintName: string; hostPort?: number | null }>;
    onSelectSession: (id: string) => void;
    onRemoveSession: (id: string) => void;
  }) => (
    <div>
      {sessions.map((session) => (
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
    navigationEnabled = true,
    children,
  }: {
    addressValue: string;
    onAddressChange: (value: string) => void;
    navigationEnabled?: boolean;
    children: ComponentChildren;
  }) => (
    <div>
      <input
        value={addressValue}
        disabled={!navigationEnabled}
        onInput={(event) => onAddressChange((event.currentTarget as HTMLInputElement).value)}
      />
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
  afterEach(() => {
    mockStartPreviewSession.mockClear();
    mockRemovePreviewSession.mockClear();
    mockRefreshSessions.mockClear();
    vi.mocked(fetchPreviewScript).mockClear();
  });

  it("renders correctly with new slider and chrome components", async () => {
    let container!: HTMLElement;
    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    expect(screen.getByText("Build previews per sprint, isolated by container.")).toBeInTheDocument();
    const pageRoot = screen.getByTestId("browser-page-root");
    expect(pageRoot.className).toContain("px-8");
    expect(pageRoot.className).toContain("py-12");
    expect(pageRoot.className).toContain("md:px-20");
    expect(screen.getByTestId("browser-page-header")).toBeInTheDocument();
    expect(screen.getByTestId("browser-main-tool-panel")).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("button", { name: "Script" }));
    });

    expect(vi.mocked(fetchPreviewScript)).toHaveBeenCalledWith("p1", "s1");
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

    const iframe = screen.getByTitle("Sprint preview Sprint 2");
    const { protocol, port } = new URL(window.location.origin);
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", `${protocol}//preview-sess-2.localhost${port ? `:${port}` : ""}/`);
    expect(screen.getByDisplayValue("/")).toBeDisabled();
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

    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);

    await act(async () => {
      resolveRemoval?.();
    });

    expect(mockRemovePreviewSession).toHaveBeenCalledWith("sess-1");
  });
});
