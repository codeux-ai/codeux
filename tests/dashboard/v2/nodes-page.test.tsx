/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODES_CANVAS_STORAGE_KEY, NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";

const api = vi.hoisted(() => ({ fetchNodeFlows: vi.fn(), fetchNodeFlowCatalog: vi.fn(), createNodeFlowDraft: vi.fn(), fetchNodeFlow: vi.fn(), fetchNodeFlowRuns: vi.fn(), fetchNodeFlowNodeRuns: vi.fn(), fetchNodeFlowAttempts: vi.fn(), fetchNodeFlowApprovals: vi.fn(), fetchNodeFlowAgentSkills: vi.fn(), attachNodeFlowToAgent: vi.fn(), detachNodeFlowFromAgent: vi.fn(), decideNodeFlowApproval: vi.fn(), patchNodeFlowDraft: vi.fn(), fetchNodeDefinition: vi.fn(), validateNodeFlowDraft: vi.fn(), deleteNodeFlow: vi.fn() }));
const agentApi = vi.hoisted(() => ({ fetchAgentPresets: vi.fn() }));
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", async (original) => ({ ...(await original()), ...api }));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", async (original) => ({ ...(await original()), ...agentApi }));
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));

const flow = { id: "flow-1", projectId: "project-1", title: "Release automation", description: "Governed", graph: { schemaVersion: 2 as const, nodes: [{ id: "input-1", type: "input", title: "Input", definition: { type: "input", version: 1 }, position: { x: 40, y: 40 } }], edges: [] }, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const agentOne = { id: "agent-1", projectId: "project-1", name: "Release Agent", description: "", instructionMarkdown: "", labels: [], sourcePath: null, sourceScope: null, sourceUpdatedAt: null, sourceImportedAt: null, sourceExists: false, syncStatus: "in_sync", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const agentTwo = { ...agentOne, id: "agent-2", name: "QA Agent" };
const attachmentOne = { flowId: "flow-1", projectId: "project-1", agentPresetId: "agent-1", skillName: "Release automation", description: "Governed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const attachmentTwo = { ...attachmentOne, agentPresetId: "agent-2" };
const context = { projects: [{ id: "project-1", name: "Test project" }], selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "Test project" }, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined };

describe("NodesPage governed workspace", () => {
  const review = { flowId: "flow-1", projectId: "project-1", name: "Release automation", description: "Governed", draftRevision: 2, nodeCount: 1, edgeCount: 0, valid: true, validationIssues: [], policyFindings: [], requiredCredentials: [], requestedCapabilities: [], sideEffectDiffs: [], publishedVersion: 1 };
  beforeEach(() => { api.validateNodeFlowDraft.mockResolvedValue(review); });
  beforeEach(() => { window.localStorage.clear(); api.fetchNodeFlows.mockResolvedValue({ flows: [flow] }); api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [{ type: "input", version: 1, executable: true, executionKind: "local", label: "Input", description: "Input", category: "Core", credentials: [], capabilities: [], sideEffect: "none", ports: [] }] }); agentApi.fetchAgentPresets.mockResolvedValue([agentOne, agentTwo]); api.fetchNodeFlowAgentSkills.mockResolvedValue([attachmentOne]); api.attachNodeFlowToAgent.mockResolvedValue(attachmentTwo); api.detachNodeFlowFromAgent.mockResolvedValue(undefined); api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] }); api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] }); api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] }); api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] }); api.fetchNodeDefinition.mockResolvedValue({ type: "input", version: 1, executable: true, executionKind: "local", configurationSchema: { type: "object" }, ui: { label: "Input", description: "Input", category: "Core", widgetSchema: { fields: [] } }, ports: [], credentials: [], capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false } }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("loads a project flow library and registry-backed editor", async () => {
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    expect(await screen.findByRole("heading", { name: "Automation workspace" })).toBeInTheDocument();
    expect(await screen.findByText("Release automation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node catalog" })).toBeInTheDocument();
    expect(screen.getByText("Run debugger")).toBeInTheDocument();
    expect(api.fetchNodeFlows).toHaveBeenCalledWith("project-1", expect.any(AbortSignal));
    expect(agentApi.fetchAgentPresets).toHaveBeenCalledWith("project-1", expect.any(AbortSignal));
    expect(api.fetchNodeFlowAgentSkills).toHaveBeenCalledWith("flow-1", expect.any(AbortSignal));
    expect(screen.getByText("Release Agent")).toBeInTheDocument();
    expect(screen.getByText("Release automation", { selector: "p" })).toBeInTheDocument();
  });

  it("shows an explicit loading state while project agents are loading", async () => {
    let resolveAgents!: (agents: typeof agentOne[]) => void;
    agentApi.fetchAgentPresets.mockReturnValueOnce(new Promise((resolve) => { resolveAgents = resolve; }));
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    expect(await screen.findByText("Loading project agents and flow attachments…")).toBeInTheDocument();
    resolveAgents([agentOne]);
    await waitFor(() => expect(screen.queryByText("Loading project agents and flow attachments…")).not.toBeInTheDocument());
  });

  it("attaches the selected project agent and refreshes flow attachments", async () => {
    const user = userEvent.setup();
    api.fetchNodeFlowAgentSkills.mockResolvedValueOnce([attachmentOne]).mockResolvedValueOnce([attachmentOne, attachmentTwo]);
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release Agent");
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent preset" }), "agent-2");
    await user.click(screen.getByRole("button", { name: "Attach node flow to agent" }));
    await waitFor(() => expect(api.attachNodeFlowToAgent).toHaveBeenCalledWith("flow-1", { agentPresetId: "agent-2" }));
    expect(await screen.findByText("Flow attached to the selected project agent.")).toBeInTheDocument();
    expect(api.fetchNodeFlowAgentSkills).toHaveBeenCalledTimes(2);
    expect(screen.getByText("QA Agent")).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: "Agent preset" }) as HTMLSelectElement).value).toBe("");
  });

  it("detaches an attached agent and refreshes flow attachments", async () => {
    const user = userEvent.setup();
    api.fetchNodeFlowAgentSkills.mockResolvedValueOnce([attachmentOne]).mockResolvedValueOnce([]);
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await user.click(await screen.findByRole("button", { name: "Detach Release Agent" }));
    await waitFor(() => expect(api.detachNodeFlowFromAgent).toHaveBeenCalledWith("flow-1", "agent-1"));
    expect(await screen.findByText("No agents attached.")).toBeInTheDocument();
    expect(api.fetchNodeFlowAgentSkills).toHaveBeenCalledTimes(2);
  });

  it("clears attachment selection and loads only the newly selected project's agents and bindings", async () => {
    const user = userEvent.setup();
    const flowTwo = { ...flow, id: "flow-2", projectId: "project-2", title: "Project two flow" };
    const agentThree = { ...agentOne, id: "agent-3", projectId: "project-2", name: "Project Two Agent" };
    api.fetchNodeFlows.mockImplementation(async (projectId: string) => ({ flows: [projectId === "project-1" ? flow : flowTwo] }));
    agentApi.fetchAgentPresets.mockImplementation(async (projectId: string) => projectId === "project-1" ? [agentOne, agentTwo] : [agentThree]);
    api.fetchNodeFlowAgentSkills.mockImplementation(async (flowId: string) => flowId === "flow-1" ? [attachmentOne] : []);
    const { rerender } = render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release Agent");
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent preset" }), "agent-2");
    const projectTwoContext = { ...context, projects: [{ id: "project-2", name: "Second project" }], selectedProjectId: "project-2", selectedProject: { id: "project-2", name: "Second project" } };
    rerender(<ProjectDataContext.Provider value={projectTwoContext as never}><NodesPage /></ProjectDataContext.Provider>);
    expect(await screen.findByText("Project two flow")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Agent preset" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Project Two Agent" })).toBeInTheDocument();
    expect(screen.queryByText("Release Agent")).not.toBeInTheDocument();
    expect(agentApi.fetchAgentPresets).toHaveBeenLastCalledWith("project-2", expect.any(AbortSignal));
    expect(api.fetchNodeFlowAgentSkills).toHaveBeenLastCalledWith("flow-2", expect.any(AbortSignal));
  });

  it("keeps existing bindings visible and exposes retry when an attachment API fails", async () => {
    const user = userEvent.setup();
    api.attachNodeFlowToAgent.mockRejectedValueOnce(new Error("Attachment service unavailable"));
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release Agent");
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent preset" }), "agent-2");
    await user.click(screen.getByRole("button", { name: "Attach node flow to agent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Attachment service unavailable");
    expect(screen.getByText("Release Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("supports keyboard activation for attach and detach controls", async () => {
    const user = userEvent.setup();
    api.fetchNodeFlowAgentSkills.mockResolvedValueOnce([attachmentOne]).mockResolvedValueOnce([attachmentOne, attachmentTwo]).mockResolvedValueOnce([attachmentTwo]);
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release Agent");
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent preset" }), "agent-2");
    const attachButton = screen.getByRole("button", { name: "Attach node flow to agent" });
    attachButton.focus();
    expect(attachButton).toHaveFocus();
    await user.keyboard("{Enter}");
    const detachButton = await screen.findByRole("button", { name: "Detach Release Agent" });
    detachButton.focus();
    expect(detachButton).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.detachNodeFlowFromAgent).toHaveBeenCalledWith("flow-1", "agent-1"));
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
