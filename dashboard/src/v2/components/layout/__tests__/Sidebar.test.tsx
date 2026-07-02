/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    useRouterState: vi.fn(() => ({ matches: [{ pathname: "/" }] })),
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
}));

vi.mock("../../../lib/motion/index.js", () => ({
  useAnimatedActiveIndicator: vi.fn(() => ({ style: {} })),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.setItem("codeux:sidebar:minimized", "true");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps minimized footer controls accessible without custom hover labels", () => {
    render(<Sidebar />);

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    const expandButton = screen.getByRole("button", { name: "Expand sidebar" });

    expect(settingsLink).toBeInTheDocument();
    expect(expandButton).toBeInTheDocument();
    expect(within(settingsLink).queryByText("Settings", { selector: "[aria-hidden='true']" })).not.toBeInTheDocument();
    expect(within(expandButton).queryByText("Expand", { selector: "[aria-hidden='true']" })).not.toBeInTheDocument();
  });
});
