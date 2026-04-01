// @vitest-environment jsdom
/** @jsx h */
import { h } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserPage } from "../../../dashboard/src/v2/BrowserPage.js";
import { PreviewSessionSlider } from "../../../dashboard/src/v2/components/browser/PreviewSessionSlider.js";
import { PreviewWindowChrome } from "../../../dashboard/src/v2/components/browser/PreviewWindowChrome.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    selectedProject: { id: "p1", name: "Project 1" },
  })),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(() => ({
    data: [{ id: "s1", name: "Sprint 1" }],
    selectedSprint: { id: "s1", name: "Sprint 1" },
    selectedSprintId: "s1",
  })),
}));

const mockRefreshSessions = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
  usePreviewSessions: vi.fn(() => ({
    sessions: [
      {
        id: "sess-1",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint 1",
        status: "running",
        healthStatus: "healthy",
        containerAppPort: 3000,
        hostPort: 8080,
      },
      {
        id: "sess-2",
        projectId: "p1",
        sprintId: "s2",
        sprintName: "Sprint 2",
        status: "stopped",
        healthStatus: "unknown",
        containerAppPort: 3000,
        hostPort: null,
      },
    ],
    selectedSession: {
      id: "sess-1",
      projectId: "p1",
      sprintId: "s1",
      sprintName: "Sprint 1",
      status: "running",
      healthStatus: "healthy",
      containerAppPort: 3000,
      hostPort: 8080,
    },
    loading: false,
    error: null,
    refresh: mockRefreshSessions,
  })),
}));

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
  fetchPreviewLogs: vi.fn().mockResolvedValue({ logs: "mock logs" }),
  fetchPreviewScript: vi.fn().mockResolvedValue({ content: "mock script", mode: "script", path: "/script.sh" }),
  rebuildPreviewSession: vi.fn().mockResolvedValue(undefined),
  savePreviewScript: vi.fn().mockResolvedValue({ content: "new mock script", mode: "script", path: "/script.sh" }),
  startPreviewSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
  stopPreviewSession: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
});

describe("PreviewSessionSlider", () => {
  it("renders multiple session cards", () => {
    const onSelect = vi.fn();
    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-1",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Unique Sprint A",
            status: "running",
            healthStatus: "healthy",
            createdAt: "",
            updatedAt: ""
          },
          {
            id: "slider-sess-2",
            projectId: "p1",
            sprintId: "s2",
            sprintName: "Unique Sprint B",
            status: "stopped",
            healthStatus: "unknown",
            createdAt: "",
            updatedAt: ""
          },
        ]}
        selectedSessionId="slider-sess-1"
        onSelectSession={onSelect}
      />
    );

    expect(screen.getByText("Unique Sprint A")).toBeInTheDocument();
    expect(screen.getByText("Unique Sprint B")).toBeInTheDocument();

    const openLinks = screen.getAllByText("Open Link");
    expect(openLinks.length).toBe(2);
  });

  it("calls onSelectSession when a card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-1",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Clickable Sprint",
            status: "running",
            healthStatus: "healthy",
            createdAt: "",
            updatedAt: ""
          },
        ]}
        selectedSessionId={null}
        onSelectSession={onSelect}
      />
    );

    // Click the button inside the card that represents the selection action
    const button = screen.getByText("Clickable Sprint").closest("button");
    if (button) {
      fireEvent.click(button);
    }
    expect(onSelect).toHaveBeenCalledWith("slider-sess-1");
  });
});

describe("PreviewWindowChrome", () => {
  const session = {
    id: "chrome-sess-1",
    projectId: "p1",
    sprintId: "s1",
    sprintName: "Chrome Sprint",
    status: "running" as const,
    healthStatus: "healthy" as const,
    createdAt: "",
    updatedAt: ""
  };

  const defaultProps = {
    session,
    onNavigateBack: vi.fn(),
    onNavigateForward: vi.fn(),
    onReload: vi.fn(),
    onAddressSubmit: vi.fn(),
    addressValue: "/",
    onAddressChange: vi.fn(),
  };

  it("renders in normal state by default with children", () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child" />
      </PreviewWindowChrome>
    );
    expect(screen.getByTestId("test-child")).toBeInTheDocument();
    expect(container.querySelector(".fixed")).not.toBeInTheDocument();
  });

  it("toggles fullscreen mode", async () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child" />
      </PreviewWindowChrome>
    );

    const controls = container.querySelectorAll("button.group");
    const maximizeBtn = controls[2]; // Close, Minimize, Fullscreen

    await act(async () => {
      fireEvent.click(maximizeBtn!);
    });

    expect(container.querySelector(".fixed.inset-0.z-50")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(maximizeBtn!);
    });

    expect(container.querySelector(".fixed.inset-0.z-50")).not.toBeInTheDocument();
  });

  it("toggles minimize mode hiding iframe wrapper", async () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child-minimize" />
      </PreviewWindowChrome>
    );

    const controls = container.querySelectorAll("button.group");
    const minimizeBtn = controls[1]; // Close, Minimize, Fullscreen

    await act(async () => {
      fireEvent.click(minimizeBtn!);
    });

    // Child is still in the document
    expect(screen.getByTestId("test-child-minimize")).toBeInTheDocument();

    // But its container is hidden
    const childWrapper = screen.getByTestId("test-child-minimize").parentElement!.parentElement!;
    expect(childWrapper.classList.contains("hidden")).toBe(true);

    expect(screen.getByText("Restore")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Restore"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
  });

  it("toggles close mode hiding iframe wrapper", async () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child-close" />
      </PreviewWindowChrome>
    );

    const controls = container.querySelectorAll("button.group");
    const closeBtn = controls[0]; // Close, Minimize, Fullscreen

    await act(async () => {
      fireEvent.click(closeBtn!);
    });

    // Child is still in the document
    expect(screen.getByTestId("test-child-close")).toBeInTheDocument();

    // But its container is hidden
    const childWrapper = screen.getByTestId("test-child-close").parentElement!.parentElement!;
    expect(childWrapper.classList.contains("hidden")).toBe(true);

    expect(screen.getByText("Window Closed")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Reopen Window"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
  });
});

describe("BrowserPage", () => {
  it("renders correctly with new slider and chrome components", async () => {
    let container!: HTMLElement;
    await act(async () => {
      const result = render(<BrowserPage />);
      container = result.container;
    });

    expect(screen.getByText("Build previews per sprint, isolated by container.")).toBeInTheDocument();

    expect(screen.getByText("Sprint 2")).toBeInTheDocument();
    expect(screen.getByText("Selected Sprint")).toBeInTheDocument();
    expect(screen.getAllByText("Open Link").length).toBeGreaterThan(0);

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    const selectedSprintLabel = screen.getByText("Selected Sprint");
    expect((iframe?.compareDocumentPosition(selectedSprintLabel) || 0) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
