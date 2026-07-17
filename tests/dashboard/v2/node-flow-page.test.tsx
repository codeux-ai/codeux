/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

const api = vi.hoisted(() => ({
  fetchNodeFlows: vi.fn(), fetchNodeFlowCatalog: vi.fn(), fetchNodeFlow: vi.fn(), fetchNodeFlowRuns: vi.fn(),
  fetchNodeFlowNodeRuns: vi.fn(), fetchNodeFlowAttempts: vi.fn(), fetchNodeFlowApprovals: vi.fn(),
  fetchNodeFlowAgentSkills: vi.fn(), fetchNodeDefinition: vi.fn(), validateNodeFlowDraft: vi.fn(),
  patchNodeFlowDraft: vi.fn(), deleteNodeFlow: vi.fn(),
}));
const agentApi = vi.hoisted(() => ({ fetchAgentPresets: vi.fn() }));
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", async (original) => ({ ...(await original()), ...api }));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", async (original) => ({ ...(await original()), ...agentApi }));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));
vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({ useInteractionTokens: () => ({ controlFeedback: { duration: "0ms", ease: "linear" }, enterExit: { duration: "0ms", ease: "linear" }, selectionMovement: { duration: "0ms", ease: "linear" } }), useGsapInteractionTokens: () => ({ controlFeedback: { duration: 0, ease: "linear" }, enterExit: { duration: 0, ease: "linear" }, inlineValidation: { duration: 0, ease: "linear" }, selectionMovement: { duration: 0, ease: "linear" } }) }));

const flow = { id: "flow-1", projectId: "project-1", title: "Release automation", description: "Governed", graph: { schemaVersion: 2 as const, nodes: [{ id: "input-1", type: "input", title: "Input", definition: { type: "input", version: 1 }, position: { x: 40, y: 40 } }], edges: [] }, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const secondFlow = { ...flow, id: "flow-2", title: "Quality automation", description: "Quality" };
const review = { flowId: "flow-1", projectId: "project-1", name: "Release automation", description: "Governed", draftRevision: 2, nodeCount: 1, edgeCount: 0, valid: true, validationIssues: [], policyFindings: [], requiredCredentials: [], requestedCapabilities: [], sideEffectDiffs: [], publishedVersion: 1 };
const selectedContext = { projects: [{ id: "project-1", name: "Test project" }], selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "Test project" }, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined };

const renderSelectedPage = () => render(<DashboardI18nProvider storage={null}><ProjectDataContext.Provider value={selectedContext as never}><NodesPage /></ProjectDataContext.Provider></DashboardI18nProvider>);

beforeEach(() => {
  api.fetchNodeFlows.mockResolvedValue({ flows: [flow] });
  api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [] });
  api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] });
  api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] });
  api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] });
  api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] });
  api.fetchNodeFlowAgentSkills.mockResolvedValue([]);
  api.fetchNodeDefinition.mockResolvedValue({ type: "input", version: 1, executable: true, executionKind: "local", configurationSchema: { type: "object" }, ui: { label: "Input", description: "Input", category: "Core", widgetSchema: { fields: [] } }, ports: [], credentials: [], capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false } });
  api.validateNodeFlowDraft.mockResolvedValue(review);
  agentApi.fetchAgentPresets.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("NodesPage project boundary", () => {
  it("requires a selected project before loading governed flows", () => {
    render(<DashboardI18nProvider storage={null}><ProjectDataContext.Provider value={{ projects: [], selectedProjectId: null, selectedProject: null, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined }}><NodesPage /></ProjectDataContext.Provider></DashboardI18nProvider>);
    expect(screen.getByRole("heading", { name: "Automation workspace" })).toBeInTheDocument();
    expect(screen.getByText("Select a project")).toBeInTheDocument();
    expect(screen.queryByText("Node catalog")).not.toBeInTheDocument();
  });

  it("protects a dirty draft and preserves the requested flow until the operator chooses", async () => {
    const user = userEvent.setup();
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow, secondFlow] });
    api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [] });
    api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] });
    api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] });
    api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] });
    api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] });
    api.fetchNodeFlowAgentSkills.mockResolvedValue([]);
    api.validateNodeFlowDraft.mockImplementation(async (_projectId: string, flowId: string) => ({ ...review, flowId, name: flowId === "flow-1" ? flow.title : secondFlow.title }));
    agentApi.fetchAgentPresets.mockResolvedValue([]);
    renderSelectedPage();

    await screen.findByText("Release automation");
    await user.type(screen.getAllByLabelText("Description")[0]!, " changed");
    await user.click(screen.getByText("Quality automation").closest("button")!);

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Description")[0]).toHaveValue("Governed changed");

    await user.click(screen.getByRole("button", { name: "Discard without saving" }));
    await waitFor(() => expect(screen.getAllByLabelText("Flow name")[0]).toHaveValue("Quality automation"));
  });

  it("saves once before continuing to the queued flow", async () => {
    const user = userEvent.setup();
    const savedFlow = { ...flow, description: "Governed changed", version: 3 };
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow, secondFlow] });
    api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [] });
    api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] });
    api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] });
    api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] });
    api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] });
    api.fetchNodeFlowAgentSkills.mockResolvedValue([]);
    api.validateNodeFlowDraft.mockResolvedValue(review);
    api.patchNodeFlowDraft.mockResolvedValue({ draft: { ...review, draftRevision: 3 } });
    api.fetchNodeFlow.mockResolvedValue(savedFlow);
    agentApi.fetchAgentPresets.mockResolvedValue([]);
    renderSelectedPage();

    await screen.findByText("Release automation");
    await user.type(screen.getAllByLabelText("Description")[0]!, " changed");
    await user.click(screen.getByText("Quality automation").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.patchNodeFlowDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByLabelText("Flow name")[0]).toHaveValue("Quality automation"));
  });

  it("restores focus when flow deletion is cancelled", async () => {
    const user = userEvent.setup();
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow] });
    api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [] });
    api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] });
    api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] });
    api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] });
    api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] });
    api.fetchNodeFlowAgentSkills.mockResolvedValue([]);
    api.validateNodeFlowDraft.mockResolvedValue(review);
    agentApi.fetchAgentPresets.mockResolvedValue([]);
    renderSelectedPage();

    const deleteButton = await screen.findByRole("button", { name: "Delete node flow Release automation" });
    deleteButton.focus();
    await user.click(deleteButton);
    expect(await screen.findByRole("dialog", { name: "Delete “Release automation”?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(api.deleteNodeFlow).not.toHaveBeenCalled();
  });

  it("suppresses duplicate validation requests and reports the validation outcome independently", async () => {
    const user = userEvent.setup();
    let resolveValidation: ((value: typeof review) => void) | undefined;
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow] });
    api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [] });
    api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] });
    api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] });
    api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] });
    api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] });
    api.fetchNodeFlowAgentSkills.mockResolvedValue([]);
    api.validateNodeFlowDraft.mockResolvedValue(review);
    agentApi.fetchAgentPresets.mockResolvedValue([]);
    renderSelectedPage();
    await screen.findByText("Release automation");
    api.validateNodeFlowDraft.mockClear();
    api.validateNodeFlowDraft.mockReturnValue(new Promise((resolve) => { resolveValidation = resolve; }));

    await user.dblClick(screen.getByRole("button", { name: "Validate" }));
    expect(api.validateNodeFlowDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Validating draft…")).toBeInTheDocument();

    resolveValidation?.(review);
    expect(await screen.findByText("Draft validation passed.")).toBeInTheDocument();
  });
});
