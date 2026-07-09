/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { PreviewSessionSlider } from "../../../dashboard/src/v2/components/browser/PreviewSessionSlider.js";
import { PreviewWindowChrome } from "../../../dashboard/src/v2/components/browser/PreviewWindowChrome.js";
import { LaunchContainerPanel } from "../../../dashboard/src/v2/components/browser/LaunchContainerPanel.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
            hostPort: 8081,
            createdAt: "",
            updatedAt: ""
          } as any,
          {
            id: "slider-sess-2",
            projectId: "p1",
            sprintId: "s2",
            sprintName: "Unique Sprint B",
            status: "stopped",
            healthStatus: "unknown",
            createdAt: "",
            updatedAt: ""
          } as any,
        ]}
        selectedSessionId="slider-sess-1"
        onSelectSession={onSelect}
        onRemoveSession={vi.fn()}
      />
    );

    expect(screen.getByText("Unique Sprint A")).toBeInTheDocument();
    expect(screen.getByText("Unique Sprint B")).toBeInTheDocument();
    expect(screen.getByText("Open Link")).toBeInTheDocument();
    expect(screen.getByText("Link Unavailable")).toBeInTheDocument();
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
          } as any,
        ]}
        selectedSessionId={null}
        onSelectSession={onSelect}
        onRemoveSession={vi.fn()}
      />
    );

    const button = screen.getByText("Clickable Sprint").closest("button");
    if (button) {
      fireEvent.click(button);
    }
    expect(onSelect).toHaveBeenCalledWith("slider-sess-1");
  });

  it("fires remove actions from the rail", () => {
    const onRemoveSession = vi.fn();

    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-1",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Sprint Alpha",
            status: "running",
            healthStatus: "healthy",
            hostPort: 8080,
            createdAt: "",
            updatedAt: ""
          } as any,
        ]}
        selectedSessionId="slider-sess-1"
        onSelectSession={vi.fn()}
        onRemoveSession={onRemoveSession}
      />
    );

    fireEvent.click(screen.getByLabelText("Remove preview session Sprint Alpha"));
    expect(onRemoveSession).toHaveBeenCalledWith("slider-sess-1");
  });

  it("announces selected and removing session feedback", () => {
    const onRemoveSession = vi.fn();
    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-1",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Sprint Alpha",
            status: "running",
            healthStatus: "healthy",
            hostPort: 8080,
            createdAt: "",
            updatedAt: ""
          } as any,
          {
            id: "slider-sess-2",
            projectId: "p1",
            sprintId: "s2",
            sprintName: "Sprint Beta",
            status: "starting",
            healthStatus: "unknown",
            createdAt: "",
            updatedAt: ""
          } as any,
        ]}
        selectedSessionId="slider-sess-1"
        onSelectSession={vi.fn()}
        onRemoveSession={onRemoveSession}
        removingSessionIds={["slider-sess-2"]}
      />
    );

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("removing session")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Selected preview session Sprint Alpha. Status Running.");
    const removingButton = screen.getByRole("button", { name: "Removing preview session Sprint Beta" });
    expect(removingButton).toBeDisabled();
    expect(removingButton).toHaveAttribute("aria-busy", "true");
    expect(removingButton).toHaveAccessibleDescription("Preview session Sprint Beta is already being removed.");

    fireEvent.click(removingButton);
    expect(onRemoveSession).not.toHaveBeenCalled();
  });

  it("uses instant rail scrolling when reduced motion is preferred", () => {
    const scrollBy = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <PreviewSessionSlider
        sessions={Array.from({ length: 6 }, (_, index) => ({
          id: `slider-sess-${index}`,
          projectId: "p1",
          sprintId: `s${index}`,
          sprintName: `Sprint ${index}`,
          status: "running",
          healthStatus: "healthy",
          hostPort: 8080 + index,
          createdAt: "",
          updatedAt: ""
        } as any))}
        selectedSessionId="slider-sess-0"
        onSelectSession={vi.fn()}
        onRemoveSession={vi.fn()}
      />
    );

    const rail = screen.getByRole("list", { name: "6 preview sessions" });
    Object.defineProperty(rail, "scrollBy", { value: scrollBy, configurable: true });
    const scrollRightButton = screen.getByRole("button", { name: "Scroll preview sessions right" });
    expect(scrollRightButton).toHaveAttribute("aria-controls", "preview-session-rail");
    expect(scrollRightButton).not.toHaveClass("opacity-0");

    fireEvent.click(scrollRightButton);
    expect(scrollBy).toHaveBeenCalledWith({ left: 320, behavior: "auto" });
  });

  it("keeps unavailable preview links focusable with disabled reason text", () => {
    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-pending",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Pending Sprint",
            status: "starting",
            healthStatus: "unknown",
            createdAt: "",
            updatedAt: ""
          } as any,
        ]}
        selectedSessionId="slider-sess-pending"
        onSelectSession={vi.fn()}
        onRemoveSession={vi.fn()}
      />
    );

    const unavailableLink = screen.getByText("Link Unavailable").closest("a");
    expect(unavailableLink).toBeInTheDocument();
    expect(unavailableLink).not.toHaveAttribute("href");
    expect(unavailableLink).toHaveAttribute("aria-disabled", "true");
    expect(unavailableLink).toHaveAttribute("tabindex", "0");
    expect(unavailableLink).toHaveAccessibleDescription("Preview link unavailable until the container finishes starting and receives a routed host port.");
    expect(screen.getByText("Preview link unavailable until the container finishes starting and receives a routed host port.")).toBeInTheDocument();
  });

  it("disables stopped routed preview links with a persistent recovery reason", () => {
    render(
      <PreviewSessionSlider
        sessions={[
          {
            id: "slider-sess-stopped",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Stopped Sprint",
            status: "stopped",
            healthStatus: "unknown",
            hostPort: 8088,
            createdAt: "",
            updatedAt: ""
          } as any,
        ]}
        selectedSessionId="slider-sess-stopped"
        onSelectSession={vi.fn()}
        onRemoveSession={vi.fn()}
      />
    );

    const unavailableLink = screen.getByText("Link Unavailable").closest("a");
    expect(unavailableLink).toBeInTheDocument();
    expect(unavailableLink).not.toHaveAttribute("href");
    expect(unavailableLink).toHaveAttribute("aria-disabled", "true");
    expect(unavailableLink).toHaveAccessibleDescription("Preview link unavailable because the selected container is stopped. Rebuild or launch the container to open it.");
    expect(screen.getByText("Preview link unavailable because the selected container is stopped. Rebuild or launch the container to open it.")).toBeInTheDocument();
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
  } as any;

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
    expect(container.innerHTML).not.toContain("#f5f1e8");
    expect(container.innerHTML).not.toContain("#f7f3ea");
    expect(container.innerHTML).toContain("bg-[var(--surface-glass)]");
    expect(container.innerHTML).toContain("border-[color:var(--border-hairline)]");
    expect(container.innerHTML).toContain("shadow-[var(--elevation-base)]");
    expect(container.querySelector(".bg-slate-100\\/70")).toBeInTheDocument();
    expect(screen.getByLabelText("Close preview window")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimize preview window")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter preview fullscreen")).toBeInTheDocument();
    expect(screen.getByLabelText("Go back in preview session Chrome Sprint")).toBeInTheDocument();
    expect(screen.getByLabelText("Go forward in preview session Chrome Sprint")).toBeInTheDocument();
    expect(screen.getByLabelText("Reload preview session Chrome Sprint at /")).toBeInTheDocument();
    expect(screen.getByLabelText("Preview address for Chrome Sprint")).toBeInTheDocument();
  });

  it("renders the no-session state without a framed empty viewport", () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps} session={null}>
        <div data-testid="inactive-child" />
      </PreviewWindowChrome>
    );

    expect(screen.getByRole("status")).toHaveTextContent("No preview active");
    expect(screen.getByText("Start a sprint preview to build the selected sprint into its own isolated container and browse it directly from the dashboard.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("bg-[var(--surface-glass)]");
    expect(container.querySelector(".bg-slate-100\\/70")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inactive-child")).not.toBeInTheDocument();
  });

  it("toggles fullscreen mode", async () => {
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child" />
      </PreviewWindowChrome>
    );

    const controls = container.querySelectorAll("button.group");
    const maximizeBtn = controls[2];

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
    render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child-minimize" />
      </PreviewWindowChrome>
    );

    const controls = document.querySelectorAll("button.group");
    const minimizeBtn = controls[1];

    await act(async () => {
      fireEvent.click(minimizeBtn!);
    });

    expect(screen.getByTestId("test-child-minimize")).toBeInTheDocument();
    const childWrapper = screen.getByTestId("test-child-minimize").parentElement!.parentElement!;
    expect(childWrapper.classList.contains("hidden")).toBe(true);
    expect(screen.getByText("Restore")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Preview window is minimized. Use Restore to reopen it." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore preview window" })).toHaveFocus();

    await act(async () => {
      fireEvent.click(screen.getByText("Restore"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
    expect(screen.getByLabelText("Minimize preview window")).toHaveFocus();
  });

  it("toggles close mode hiding iframe wrapper", async () => {
    render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child-close" />
      </PreviewWindowChrome>
    );

    const controls = document.querySelectorAll("button.group");
    const closeBtn = controls[0];

    await act(async () => {
      fireEvent.click(closeBtn!);
    });

    expect(screen.getByTestId("test-child-close")).toBeInTheDocument();
    const childWrapper = screen.getByTestId("test-child-close").parentElement!.parentElement!;
    expect(childWrapper.classList.contains("hidden")).toBe(true);
    expect(screen.getByText("Window Closed")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Preview window is closed. The preview session can keep running in the background." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen preview window" })).toHaveFocus();

    await act(async () => {
      fireEvent.click(screen.getByText("Reopen Window"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
    expect(screen.getByLabelText("Close preview window")).toHaveFocus();
  });

  it("describes disabled and pending navigation controls", () => {
    render(
      <PreviewWindowChrome
        {...defaultProps}
        navigationEnabled={false}
        navigationDisabledReason="Preview navigation is disabled until the running container receives a routed host port."
      >
        <div data-testid="test-child-disabled" />
      </PreviewWindowChrome>
    );

    const address = screen.getByLabelText("Preview address for Chrome Sprint");
    expect(address).toBeDisabled();
    expect(address).toHaveAccessibleDescription("Preview navigation is disabled until the running container receives a routed host port.");
    expect(screen.getAllByText("Preview navigation is disabled until the running container receives a routed host port.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Go back in preview session Chrome Sprint" })).toBeDisabled();
  });

  it("prevents duplicate navigation while a command is pending", () => {
    const onReload = vi.fn();
    render(
      <PreviewWindowChrome {...defaultProps} navigationBusy={true} onReload={onReload}>
        <div data-testid="test-child-pending" />
      </PreviewWindowChrome>
    );

    const reload = screen.getByRole("button", { name: "Reload preview session Chrome Sprint at /" });
    expect(reload).toBeDisabled();
    expect(reload).toHaveAttribute("aria-busy", "true");
    expect(reload).toHaveAccessibleDescription("Preview navigation is sending the previous command. Wait for the control to become available before submitting another navigation command.");

    fireEvent.click(reload);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("renders accessible port tabs and supports keyboard selection", async () => {
    const user = userEvent.setup();
    const onSelectPort = vi.fn();
    render(
      <PreviewWindowChrome
        {...defaultProps}
        portMappings={[
          { containerPort: 3000, hostPort: 8080, isPrimary: true },
          { containerPort: 5173, hostPort: 8081, label: "Vite" },
        ]}
        selectedContainerPort={3000}
        onSelectPort={onSelectPort}
      >
        <div data-testid="test-child-ports" />
      </PreviewWindowChrome>
    );

    const tablist = screen.getByRole("tablist", { name: "Preview ports for Chrome Sprint" });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Select preview port :3000 routed to host port 8080" })).toHaveAttribute("aria-selected", "true");

    const primaryTab = screen.getByRole("tab", { name: "Select preview port :3000 routed to host port 8080" });
    primaryTab.focus();
    await user.keyboard("[ArrowRight]");

    expect(onSelectPort).toHaveBeenCalledWith(5173);
    expect(screen.getByRole("tab", { name: "Select preview port Vite :5173 routed to host port 8081" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Select preview port Vite :5173 routed to host port 8081" })).toHaveAttribute("aria-controls", "preview-window-frame");

    await user.keyboard("[Home]");
    expect(onSelectPort).toHaveBeenLastCalledWith(3000);
    expect(screen.getByRole("tab", { name: "Select preview port :3000 routed to host port 8080" })).toHaveFocus();

    await user.keyboard("[End]");
    expect(onSelectPort).toHaveBeenLastCalledWith(5173);
    expect(screen.getByRole("tab", { name: "Select preview port Vite :5173 routed to host port 8081" })).toHaveFocus();
  });

  it("does not render port tab chrome for legacy single-port sessions", () => {
    render(
      <PreviewWindowChrome
        {...defaultProps}
        portMappings={[
          { containerPort: 3000, hostPort: 8080, isPrimary: true },
        ]}
        selectedContainerPort={3000}
      >
        <div data-testid="test-child-single-port" />
      </PreviewWindowChrome>
    );

    expect(screen.queryByRole("tablist", { name: /Preview ports/i })).not.toBeInTheDocument();
  });

  it("supports keyboard minimize, restore, fullscreen, and close actions", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PreviewWindowChrome {...defaultProps}>
        <div data-testid="test-child-keyboard" />
      </PreviewWindowChrome>
    );

    await user.tab();
    expect(screen.getByLabelText("Close preview window")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Minimize preview window")).toHaveFocus();
    await user.keyboard("[Enter]");
    expect(screen.getByRole("button", { name: "Restore preview window" })).toBeInTheDocument();

    screen.getByRole("button", { name: "Restore preview window" }).focus();
    await user.keyboard("[Enter]");
    expect(screen.queryByRole("button", { name: "Restore preview window" })).not.toBeInTheDocument();

    screen.getByLabelText("Enter preview fullscreen").focus();
    await user.keyboard("[Enter]");
    expect(container.querySelector(".fixed.inset-0.z-50")).toBeInTheDocument();

    screen.getByLabelText("Restore preview window").focus();
    await user.keyboard("[Enter]");
    expect(container.querySelector(".fixed.inset-0.z-50")).not.toBeInTheDocument();

    screen.getByLabelText("Close preview window").focus();
    await user.keyboard("[Enter]");
    expect(screen.getByRole("button", { name: "Reopen preview window" })).toBeInTheDocument();
  });
});

describe("LaunchContainerPanel", () => {
  const sprints = [
    { id: "s1", name: "Sprint 1" },
    { id: "s2", name: "Sprint 2" },
  ] as any;

  it("shows launch pending state and disables duplicate launch actions", () => {
    const onLaunch = vi.fn();
    render(
      <LaunchContainerPanel
        sprints={sprints}
        launchSprintId="s1"
        onLaunchSprintChange={vi.fn()}
        onLaunchContainer={onLaunch}
        launchEnabled={true}
        launchBusy={true}
      />
    );

    expect(screen.getByText("Launching")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Launching preview container for Sprint 1. Launch controls are temporarily unavailable and the selected sprint is preserved.");
    expect(screen.getByRole("combobox")).toBeDisabled();
    const button = screen.getByRole("button", { name: "Launching preview container" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("explains disabled launch states with visible status text", () => {
    const { rerender } = render(
      <LaunchContainerPanel
        sprints={[]}
        launchSprintId=""
        onLaunchSprintChange={vi.fn()}
        onLaunchContainer={vi.fn()}
        launchEnabled={true}
        launchBusy={false}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("No sprint is available to launch.");
    expect(screen.getByRole("button", { name: "Launch preview container" })).toHaveTextContent("Disabled: No Sprint");

    rerender(
      <LaunchContainerPanel
        sprints={sprints}
        launchSprintId=""
        onLaunchSprintChange={vi.fn()}
        onLaunchContainer={vi.fn()}
        launchEnabled={true}
        launchBusy={false}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Select a sprint before launching a preview container.");
    expect(screen.getByRole("button", { name: "Launch preview container" })).toHaveTextContent("Disabled: Select Sprint");
  });
});
