/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodesPage } from "../../../dashboard/src/v2/NodesPage.js";

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T): T => duration,
}));

vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({
  useInteractionTokens: () => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
    selectionMovement: { duration: "0ms", ease: "linear" },
  }),
  useGsapInteractionTokens: () => ({
    controlFeedback: { duration: 0, ease: "linear" },
    enterExit: { duration: 0, ease: "linear" },
    inlineValidation: { duration: 0, ease: "linear" },
    selectionMovement: { duration: 0, ease: "linear" },
  }),
}));

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("NodesPage legacy node-flow route coverage", () => {
  it("renders the local nodes canvas instead of backend-backed flow management", () => {
    render(<NodesPage />);

    expect(screen.getByRole("heading", { name: "Nodes Canvas" })).toBeInTheDocument();
    expect(screen.getByText(/Compose local workflow graphs/i)).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Node canvas" })).toBeInTheDocument();
  });
});
