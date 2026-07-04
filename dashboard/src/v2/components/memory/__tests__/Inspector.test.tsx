/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Inspector } from "../Inspector.js";
import type { MemNode, Edge } from "../../../lib/memory-graph.js";

expect.extend(matchers);

const requestConfirm = vi.fn().mockResolvedValue(true);

vi.mock("gsap", () => ({
  default: {
    set: vi.fn(),
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../../hooks/use-confirm-dialog.js", () => ({
  useConfirmDialog: () => ({
    isOpen: false,
    options: null,
    requestConfirm,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    triggerRef: { current: null },
  }),
}));

const node = (overrides: Partial<MemNode> = {}): MemNode => ({
  id: "memory-alpha-123456",
  content: "Use sanitized fixture content for durable memory cards.",
  category: "architecture",
  scope: "project",
  strength: 0.83,
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  radius: 8,
  scale: 1,
  opacity: 1,
  glow: 0,
  alive: true,
  ...overrides,
});

describe("Inspector", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("groups selected memory content, metadata, and related memories", () => {
    const allNodes = [
      node(),
      node({
        id: "memory-beta-123456",
        content: "Related sanitized memory content.",
        category: "patterns",
        scope: "project",
        strength: 0.72,
      }),
    ];
    const edges: Edge[] = [{ a: 0, b: 1, similarity: 0.78 }];

    const { getByRole, getByText } = render(
      <Inspector node={allNodes[0]} allNodes={allNodes} edges={edges} lobotomize={false} onClose={vi.fn()} onDelete={vi.fn()} />
    );

    expect(getByText("Memory inspector")).toBeInTheDocument();
    expect(getByRole("heading", { name: "Content" })).toBeInTheDocument();
    expect(getByRole("heading", { name: "Metadata" })).toBeInTheDocument();
    expect(getByText("Strength signal")).toBeInTheDocument();
    expect(getByText("memory-a...")).toBeInTheDocument();
    expect(getByRole("heading", { name: "Related memories" })).toBeInTheDocument();
    expect(getByText("Related sanitized memory content.")).toBeInTheDocument();
    expect(getByText("78%")).toBeInTheDocument();
  });

  test("shows sparse related-memory copy when no edges connect", () => {
    const { getByText } = render(
      <Inspector node={node()} allNodes={[node()]} edges={[]} lobotomize={false} onClose={vi.fn()} onDelete={vi.fn()} />
    );

    expect(getByText("No related memories in the current graph view.")).toBeInTheDocument();
  });

  test("preserves destructive confirmation path in delete mode", async () => {
    const onDelete = vi.fn();
    const { getByRole, getByText } = render(
      <Inspector node={node()} allNodes={[node()]} edges={[]} lobotomize={true} onClose={vi.fn()} onDelete={onDelete} />
    );

    expect(getByText("Delete mode is active. This removes the selected memory after confirmation.")).toBeInTheDocument();
    await fireEvent.click(getByRole("button", { name: "Excise Memory" }));

    expect(requestConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(onDelete).toHaveBeenCalledWith("memory-alpha-123456");
  });
});
