/** @vitest-environment jsdom */
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRouterState } from "@tanstack/react-router";
import { useProjectData } from "../../../context/project-data.js";
import { useProjectEffectiveSettings } from "../../../hooks/use-project-effective-settings.js";
import { Sidebar } from "../Sidebar.js";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, to, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useRouterState: vi.fn(() => [{ pathname: "/" }]),
  };
});

vi.mock("../../../context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({ selectedProject: null })),
}));

vi.mock("../../../hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(() => ({ data: null })),
}));

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
  useResolvedMotionDuration: vi.fn(() => "0ms"),
}));

vi.mock("../../../lib/motion/index.js", () => ({
  useAnimatedActiveIndicator: vi.fn(() => ({ style: {} })),
  useGsapInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: 0, ease: "power2.out" },
    enterExit: { duration: 0, ease: "power2.out" },
    expansionCollapse: { duration: 0, ease: "power2.inOut" },
    selectionMovement: { duration: 0, ease: "power2.out" },
    listReveal: { duration: 0, ease: "power2.out" },
    listReorder: { duration: 0, ease: "power2.out" },
    inlineValidation: { duration: 0, ease: "elastic.out(1, 0.4)" },
    asyncFeedback: { duration: 0, ease: "linear" },
  })),
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    enterExit: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    expansionCollapse: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    selectionMovement: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    listReveal: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    listReorder: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    inlineValidation: { duration: "0ms", ease: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    asyncFeedback: { duration: "0ms", ease: "linear" },
  })),
}));

function MobileSidebarHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open navigation
      </button>
      <main data-focus-fallback tabIndex={-1}>
        Fallback content
      </main>
      <Sidebar isMobile isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.setItem("codeux:sidebar:minimized", "true");
    vi.mocked(useRouterState).mockReturnValue([{ pathname: "/" }] as any);
    vi.mocked(useProjectData).mockReturnValue({ selectedProject: null } as any);
    vi.mocked(useProjectEffectiveSettings).mockReturnValue({ data: null } as any);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps minimized navigation items and footer controls named with keyboard-visible tooltip labels", () => {
    render(<Sidebar />);

    const chatLink = screen.getByRole("link", { name: "Chat" });
    const settingsLink = screen.getByRole("link", { name: "Settings" });
    const expandButton = screen.getByRole("button", { name: "Expand sidebar" });

    expect(chatLink).toHaveAccessibleName("Chat");
    expect(chatLink).toHaveAttribute("aria-describedby", "nav-tooltip-chat");
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveAttribute("aria-describedby", "nav-tooltip-settings");
    expect(expandButton).toBeInTheDocument();
    expect(expandButton).toHaveAttribute("aria-describedby", "nav-tooltip-sidebar-toggle");
    expect(within(settingsLink).getByText("Settings", { selector: "[aria-hidden='true']" })).toBeInTheDocument();
    expect(within(expandButton).getByText("Expand sidebar", { selector: "[aria-hidden='true']" })).toBeInTheDocument();
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(expandButton).toHaveAttribute("aria-controls", "primary-navigation");
  });

  it("names mobile sidebar landmarks distinctly", () => {
    localStorage.setItem("codeux:sidebar:minimized", "false");

    render(<Sidebar isMobile isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Mobile primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Mobile workspace navigation" })).toBeInTheDocument();
  });

  it("restores focus to the mobile drawer trigger after Escape closes it", async () => {
    localStorage.setItem("codeux:sidebar:minimized", "false");
    render(<MobileSidebarHarness />);

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(await screen.findByRole("dialog", { name: "Mobile primary navigation" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps active route feedback visible when reduced motion removes movement", () => {
    localStorage.setItem("codeux:sidebar:minimized", "false");
    vi.mocked(useRouterState).mockReturnValue([{ pathname: "/knowledge" }] as any);

    render(<Sidebar />);

    const knowledgeLink = screen.getByRole("link", { name: "Knowledge" });
    expect(knowledgeLink).toHaveAttribute("aria-current", "page");
    expect(within(knowledgeLink).getByText("Knowledge")).toHaveClass("font-semibold");
    expect(knowledgeLink).toHaveStyle({ transitionDuration: "0ms" });
  });

  it("keeps unavailable navigation explanations reachable without hover", () => {
    localStorage.setItem("codeux:sidebar:minimized", "false");
    vi.mocked(useProjectData).mockReturnValue({ selectedProject: { id: "project-1" } } as any);
    vi.mocked(useProjectEffectiveSettings).mockReturnValue({
      data: {
        settings: {
          sprintPreview: { enabled: false, showInAppBrowser: false },
        },
      },
    } as any);

    render(<Sidebar />);

    const browserItem = screen.getByRole("link", { name: "Browser" });
    expect(browserItem).toHaveAttribute("aria-disabled", "true");
    expect(browserItem).toHaveAttribute("aria-describedby", "nav-unavailable-browser");
    expect(screen.getByText("Enable sprint preview and the in-app browser for this project")).toBeInTheDocument();
  });
});
