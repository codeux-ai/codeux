/** @vitest-environment jsdom */
/** @jsx h */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h, type ComponentChildren } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NODES_CANVAS_STORAGE_KEY,
  NodesPage,
} from "../../../dashboard/src/v2/NodesPage.js";
import {
  ALL_NAVIGATION_ITEMS,
  isRouteNavigationItem,
} from "../../../dashboard/src/v2/lib/navigation-items.js";

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T): T => duration,
}));

vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({
  useAnimatedActiveIndicator: () => ({ style: {} }),
  useGsapInteractionTokens: () => ({
    controlFeedback: { duration: 0, ease: "linear" },
    enterExit: { duration: 0, ease: "linear" },
    inlineValidation: { duration: 0, ease: "linear" },
    selectionMovement: { duration: 0, ease: "linear" },
  }),
  useInteractionTokens: () => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
    selectionMovement: { duration: "0ms", ease: "linear" },
  }),
}));

vi.mock("../../../dashboard/src/v2/components/ui/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: ComponentChildren }) => <>{children}</>,
}));

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;
HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();

const mainSource = readFileSync(join(process.cwd(), "dashboard/src/main.tsx"), "utf8");
const prefetchSource = readFileSync(join(process.cwd(), "dashboard/src/v2/router/route-prefetch.ts"), "utf8");

describe("NodesPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the composed local canvas workspace", () => {
    render(<NodesPage />);

    expect(screen.getByRole("heading", { name: "Nodes Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Node canvas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add nodes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Trigger" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to wire" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Graph JSON" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Command metadata" })).toBeInTheDocument();
    expect(screen.getByText(/codeux:nodes-canvas:v1/i)).toBeInTheDocument();
  });

  it("exercises node selection and inspector editing through reducer-backed state", async () => {
    const user = userEvent.setup();
    render(<NodesPage />);

    await user.click(screen.getByRole("button", { name: /Task Draft task node/i }));
    expect(screen.getByRole("heading", { name: "Task Draft" })).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "Implementation Task" } });

    expect(screen.getByRole("heading", { name: "Implementation Task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Implementation Task task node/i })).toBeInTheDocument();
  });

  it("persists graph changes to localStorage and restores them on the next render", async () => {
    const { unmount } = render(<NodesPage />);

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "Manual Launch" } });

    await waitFor(() => {
      expect(window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY)).toContain("Manual Launch");
    });

    unmount();
    cleanup();
    render(<NodesPage />);

    expect(screen.getByDisplayValue("Manual Launch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manual Launch trigger node/i })).toBeInTheDocument();
  });

  it("handles invalid import JSON without replacing the current graph", async () => {
    const user = userEvent.setup();
    render(<NodesPage />);

    fireEvent.input(screen.getByLabelText("Import or exported graph"), { target: { value: "not-json" } });
    await user.click(screen.getByRole("button", { name: /^Import$/i }));

    expect(screen.getByText("Serialized graph must be valid JSON.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project Trigger trigger node/i })).toBeInTheDocument();
  });

  it("supports clear and reset states without losing palette recovery", async () => {
    const user = userEvent.setup();
    render(<NodesPage />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("region", { name: "Empty node canvas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nothing selected" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Agent node" }));
    expect(screen.getByRole("button", { name: /Agent Node agent node/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: /Project Trigger trigger node/i })).toBeInTheDocument();
  });

  it("feature-gates /nodes route registration and prefetch while keeping shared metadata", () => {
    expect(mainSource).toContain('import("./v2/NodesPage.js")');
    expect(mainSource).toContain('path: "/nodes"');
    expect(mainSource).toContain('...(nodesFeatureEnabled ? [nodesRoute] : [])');
    expect(prefetchSource).toContain('"/nodes": { importer: () => import("../NodesPage.js"), feature: "nodes" }');
    expect(prefetchSource).toContain("canPrefetchRoute(path)");

    const navItem = ALL_NAVIGATION_ITEMS.find((item) => item.id === "nodes");
    expect(navItem).toBeDefined();
    expect(navItem && isRouteNavigationItem(navItem)).toBe(true);
    if (navItem && isRouteNavigationItem(navItem)) {
      expect(navItem.path).toBe("/nodes");
      expect(navItem.group).toBe("workspace");
      expect(navItem.dockSection).toBe("right");
    }
  });
});
