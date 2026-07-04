/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryPage } from "../../MemoryPage.js";
import type { GraphMetadata } from "../../lib/memory-graph.js";

expect.extend(matchers);

const mockState = vi.hoisted(() => ({
  gsapTo: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: {
    context: vi.fn((fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    }),
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis(), kill: vi.fn() })),
    to: mockState.gsapTo,
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

vi.mock("../../context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "project-1", name: "Project One" },
  }),
}));

vi.mock("../../../hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: [{ id: "sprint-1", number: 1, name: "Sprint One", goal: "Keep fixtures sanitized" }],
  }),
}));

vi.mock("../../lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../hooks/use-memory-page-data.js", () => ({
  useMemoryPageData: () => {
    const graph: GraphMetadata = {
      nodes: [{
        id: "memory-1",
        content: "Sanitized memory content for graph behavior.",
        category: "architecture",
        scope: "project",
        strength: 0.8,
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        radius: 8,
        scale: 1,
        opacity: 1,
        glow: 0,
        alive: true,
      }],
      edges: [],
      catCentroids: {
        architecture: { x: 0, y: 0, radius: 80, count: 1 },
      },
    };

    return {
      loading: false,
      records: [],
      memoryCount: 1,
      setMemoryCount: vi.fn(),
      initialModels: [],
      initialStats: { sprint: 0, agent: 0, project: 1, activeModel: null, staleEmbeddings: 0 },
      graphData: { graph, map: null },
      loadData: vi.fn(),
    };
  },
}));

vi.mock("../../hooks/use-embedding-model-status.js", () => ({
  useEmbeddingModelStatus: () => ({
    models: [],
    setModels: vi.fn(),
    stats: { sprint: 0, agent: 0, project: 1, activeModel: null, staleEmbeddings: 0 },
    setStats: vi.fn(),
    reembed: null,
    setReembed: vi.fn(),
  }),
}));

vi.mock("../../lib/memory-api.js", () => ({
  listMemories: vi.fn(),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  searchMemories: vi.fn(),
  listEmbeddingModels: vi.fn().mockResolvedValue([]),
  downloadEmbeddingModel: vi.fn(),
  selectEmbeddingModel: vi.fn(),
  deleteEmbeddingModel: vi.fn(),
  getMemoryStats: vi.fn(),
  startReembed: vi.fn(),
  getReembedProgress: vi.fn(),
  getEmbeddingMap: vi.fn(),
}));

describe("MemoryPage graph shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const requestFrame = vi.fn().mockReturnValue(1);
    const cancelFrame = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(requestFrame);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame);
    globalThis.requestAnimationFrame = requestFrame;
    globalThis.cancelAnimationFrame = cancelFrame;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
    } as any);
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 900,
      height: 600,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("renders responsive graph and list shell with sparse graph state", () => {
    const { container, getByText } = render(<MemoryPage />);

    expect(getByText("Sparse graph")).toBeInTheDocument();
    expect(getByText("Memories are present, but this scope has no similarity edges yet.")).toBeInTheDocument();

    const canvas = container.querySelector("canvas");
    const graphShell = canvas?.parentElement?.parentElement;
    expect(graphShell).toHaveClass("flex-col");
    expect(graphShell).toHaveClass("lg:flex-row");
    expect(graphShell).toHaveClass("h-[calc(100dvh-12rem)]");
  });

  test("keeps camera controls wired to zoom actions", async () => {
    const { getByTitle } = render(<MemoryPage />);

    await fireEvent.click(getByTitle("Zoom in"));
    await fireEvent.click(getByTitle("Zoom out"));
    await fireEvent.click(getByTitle("Reset view"));

    expect(mockState.gsapTo).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ zoom: 1.3 }));
    expect(mockState.gsapTo).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ zoom: 0.7 }));
    expect(mockState.gsapTo).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ x: 0, y: 0, zoom: 1 }));
  });
});
