/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODES_CANVAS_STORAGE_KEY, NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";

const api = vi.hoisted(() => ({ fetchNodeFlows: vi.fn(), fetchNodeFlowCatalog: vi.fn(), createNodeFlowDraft: vi.fn(), fetchNodeFlow: vi.fn(), fetchNodeFlowRuns: vi.fn(), fetchNodeFlowNodeRuns: vi.fn(), fetchNodeFlowAttempts: vi.fn(), patchNodeFlowDraft: vi.fn(), fetchNodeDefinition: vi.fn(), validateNodeFlowDraft: vi.fn(), deleteNodeFlow: vi.fn() }));
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", async (original) => ({ ...(await original()), ...api }));
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));

const flow = { id: "flow-1", projectId: "project-1", title: "Release automation", description: "Governed", graph: { schemaVersion: 2 as const, nodes: [{ id: "input-1", type: "input", title: "Input", definition: { type: "input", version: 1 }, position: { x: 40, y: 40 } }], edges: [] }, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const context = { projects: [{ id: "project-1", name: "Test project" }], selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "Test project" }, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined };

describe("NodesPage governed workspace", () => {
  const review = { flowId: "flow-1", projectId: "project-1", name: "Release automation", description: "Governed", draftRevision: 2, nodeCount: 1, edgeCount: 0, valid: true, validationIssues: [], policyFindings: [], requiredCredentials: [], requestedCapabilities: [], sideEffectDiffs: [], publishedVersion: 1 };
  beforeEach(() => { api.validateNodeFlowDraft.mockResolvedValue(review); });
  beforeEach(() => { window.localStorage.clear(); api.fetchNodeFlows.mockResolvedValue({ flows: [flow] }); api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [{ type: "input", version: 1, executable: true, executionKind: "local", label: "Input", description: "Input", category: "Core", credentials: [], capabilities: [], sideEffect: "none", ports: [] }] }); api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] }); api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] }); api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] }); api.fetchNodeDefinition.mockResolvedValue({ type: "input", version: 1, executable: true, executionKind: "local", configurationSchema: { type: "object" }, ui: { label: "Input", description: "Input", category: "Core", widgetSchema: { fields: [] } }, ports: [], credentials: [], capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false } }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("loads a project flow library and registry-backed editor", async () => {
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    expect(await screen.findByRole("heading", { name: "Automation workspace" })).toBeInTheDocument();
    expect(await screen.findByText("Release automation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node catalog" })).toBeInTheDocument();
    expect(screen.getByText("Run debugger")).toBeInTheDocument();
    expect(api.fetchNodeFlows).toHaveBeenCalledWith("project-1", expect.any(AbortSignal));
  });

  it("imports legacy localStorage once and removes it as a source of truth", async () => {
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, nodes: [{ id: "input-1", type: "input", title: "Input", position: { x: 1, y: 1 } }], edges: [] }));
    api.createNodeFlowDraft.mockResolvedValue({ flowId: "imported", draftRevision: 1 });
    api.fetchNodeFlows.mockResolvedValueOnce({ flows: [] }).mockResolvedValueOnce({ flows: [flow] });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await waitFor(() => expect(api.createNodeFlowDraft).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("codeux:nodes-canvas:imported:project-1")).toBe("imported");
  });

  it("surfaces optimistic save conflicts", async () => {
    const user = userEvent.setup(); api.patchNodeFlowDraft.mockResolvedValue({ conflict: { message: "The draft changed after it was read; reload the summary and reapply the patch.", actualDraftRevision: 3 } });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release automation");
    await user.type(screen.getAllByLabelText("Description")[0]!, " changed");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current revision is 3");
  });
});
