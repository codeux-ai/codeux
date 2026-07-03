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
    expect(screen.getAllByText("Open Link")).toHaveLength(2);
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
        onRemoveSession={vi.fn()}
        removingSessionIds={["slider-sess-2"]}
      />
    );

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("removing session")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Selected preview session Sprint Alpha. Status Running.");
    expect(screen.getByRole("button", { name: "Remove preview session Sprint Beta" })).toBeDisabled();
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
    expect(container.querySelector(".dark\\:bg-void-900\\/55")).toBeInTheDocument();
    expect(container.querySelector(".bg-slate-100\\/70")).toBeInTheDocument();
    expect(screen.getByLabelText("Close preview window")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimize preview window")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter preview fullscreen")).toBeInTheDocument();
    expect(screen.getByLabelText("Go back in preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Go forward in preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Reload preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Preview address")).toBeInTheDocument();
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

    await act(async () => {
      fireEvent.click(screen.getByText("Restore"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
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

    await act(async () => {
      fireEvent.click(screen.getByText("Reopen Window"));
    });

    expect(childWrapper.classList.contains("hidden")).toBe(false);
  });

  it("describes disabled and pending navigation controls", () => {
    render(
      <PreviewWindowChrome {...defaultProps} navigationEnabled={false}>
        <div data-testid="test-child-disabled" />
      </PreviewWindowChrome>
    );

    const address = screen.getByLabelText("Preview address");
    expect(address).toBeDisabled();
    expect(address).toHaveAccessibleDescription("Preview navigation controls are disabled until the selected container is running and has a routed host port.");
    expect(screen.getByRole("button", { name: "Go back in preview" })).toBeDisabled();
  });

  it("prevents duplicate navigation while a command is pending", () => {
    const onReload = vi.fn();
    render(
      <PreviewWindowChrome {...defaultProps} navigationBusy={true} onReload={onReload}>
        <div data-testid="test-child-pending" />
      </PreviewWindowChrome>
    );

    const reload = screen.getByRole("button", { name: "Reload preview" });
    expect(reload).toBeDisabled();
    expect(reload).toHaveAttribute("aria-busy", "true");
    expect(reload).toHaveAccessibleDescription("Preview navigation is sending the previous command. Wait for the control to become available before submitting another navigation command.");

    fireEvent.click(reload);
    expect(onReload).not.toHaveBeenCalled();
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
    expect(screen.getByRole("status")).toHaveTextContent("Launching preview container. Launch controls are temporarily unavailable.");
    expect(screen.getByRole("combobox")).toBeDisabled();
    const button = screen.getByRole("button", { name: "Launching preview container" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
