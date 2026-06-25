/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { PreviewSessionSlider } from "../../../dashboard/src/v2/components/browser/PreviewSessionSlider.js";
import { PreviewWindowChrome } from "../../../dashboard/src/v2/components/browser/PreviewWindowChrome.js";

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

    fireEvent.click(screen.getByLabelText("Remove preview container"));
    expect(onRemoveSession).toHaveBeenCalledWith("slider-sess-1");
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
});
