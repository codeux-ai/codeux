/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODES_CANVAS_STORAGE_KEY, NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";

const api = vi.hoisted(() => ({ fetchNodeFlows: vi.fn(), fetchNodeFlowCatalog: vi.fn(), createNodeFlowDraft: vi.fn(), fetchNodeFlow: vi.fn(), fetchNodeFlowRuns: vi.fn(), fetchNodeFlowNodeRuns: vi.fn(), fetchNodeFlowAttempts: vi.fn(), fetchNodeFlowApprovals: vi.fn(), fetchNodeFlowAgentSkills: vi.fn(), attachNodeFlowToAgent: vi.fn(), detachNodeFlowFromAgent: vi.fn(), decideNodeFlowApproval: vi.fn(), patchNodeFlowDraft: vi.fn(), fetchNodeDefinition: vi.fn(), validateNodeFlowDraft: vi.fn(), deleteNodeFlow: vi.fn() }));
const agentApi = vi.hoisted(() => ({ fetchAgentPresets: vi.fn() }));
const credentialApi = vi.hoisted(() => ({ fetchAutomationCredentials: vi.fn(), fetchCredentialHealth: vi.fn(), assessAutomationCredentialCompatibility: vi.fn() }));
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", async (original) => ({ ...(await original()), ...api }));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", async (original) => ({ ...(await original()), ...agentApi }));
vi.mock("../../../dashboard/src/v2/lib/automation-credential-api.js", () => credentialApi);
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));

const flow = { id: "flow-1", projectId: "project-1", title: "Release automation", description: "Governed", graph: { schemaVersion: 2 as const, nodes: [{ id: "input-1", type: "input", title: "Input", definition: { type: "input", version: 1 }, position: { x: 40, y: 40 } }], edges: [] }, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const agent = { id: "agent-1", projectId: "project-1", name: "Release Agent", description: "Release helper", instructionMarkdown: "PRIVATE AGENT INSTRUCTIONS", labels: [], sourcePath: null, sourceScope: null, sourceUpdatedAt: null, sourceImportedAt: null, sourceExists: false, syncStatus: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const attachment = { flowId: "flow-1", projectId: "project-1", agentPresetId: "agent-1", skillName: "Release skill", description: "Governed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const context = { projects: [{ id: "project-1", name: "Test project" }], selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "Test project" }, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined };
const credentialDefinition = {
  type: "provider_prompt", version: 1, executable: true, executionKind: "provider", configurationSchema: { type: "object" },
  ui: { label: "Provider prompt", description: "Prompt", category: "Providers", widgetSchema: { fields: [] } }, ports: [],
  credentials: [{ slot: "provider", label: "Provider connection", required: true, allowedKinds: ["provider"], requiredCapabilities: ["read"] }],
  capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false },
};
const credentialFlow = {
  ...flow,
  graph: {
    schemaVersion: 2 as const,
    nodes: [{
      id: "provider-1", type: "provider_prompt", title: "Provider prompt", description: "Prompt",
      definition: { type: "provider_prompt", version: 1 }, data: { prompt: "Keep this configuration" },
      credentialBindings: [{ slot: "audit", credentialId: "credential-audit" }], position: { x: 40, y: 40 },
    }],
    edges: [],
  },
};
const credentialMetadata = (id: string, name: string) => ({
  id, name, kind: "provider", scope: "project", projectId: "project-1", managementProjectId: "project-1",
  allowedProjectIds: [], capabilities: ["read"], status: "active", configured: true, keyId: "hidden-key",
  keyVersion: 1, version: 1, lastValidatedAt: null, validationStatus: "valid", createdAt: "now", updatedAt: "now",
});

describe("NodesPage governed workspace", () => {
  const review = { flowId: "flow-1", projectId: "project-1", name: "Release automation", description: "Governed", draftRevision: 2, nodeCount: 1, edgeCount: 0, valid: true, validationIssues: [], policyFindings: [], requiredCredentials: [], requestedCapabilities: [], sideEffectDiffs: [], publishedVersion: 1 };
  const credentialReview = (currentFlow: typeof credentialFlow, status: "bound" | "missing" | "denied" = "bound") => {
    const credentialId = currentFlow.graph.nodes[0]?.credentialBindings.find((binding) => binding.slot === "provider")?.credentialId ?? null;
    return {
      ...review,
      draftRevision: currentFlow.version,
      requiredCredentials: [{
        nodeId: "provider-1", slot: "provider", allowedKinds: ["provider"], requiredCapabilities: ["read"], required: true,
        credentialId, status: credentialId ? status : "missing", backendReady: credentialId ? true : null, configured: credentialId ? true : null,
        active: credentialId ? true : null, projectAccess: credentialId ? true : null, kindAllowed: credentialId ? true : null,
        capabilitiesAllowed: credentialId ? true : null, missingCapabilities: credentialId ? [] : ["read"], compatibilityIssues: [],
      }],
    };
  };
  const setupCredentialFlow = (initialFlow: typeof credentialFlow = credentialFlow) => {
    let canonical = initialFlow;
    api.fetchNodeFlows.mockResolvedValue({ flows: [canonical] });
    api.fetchNodeDefinition.mockResolvedValue(credentialDefinition);
    api.fetchNodeFlow.mockImplementation(async () => canonical);
    api.validateNodeFlowDraft.mockImplementation(async () => credentialReview(canonical));
    credentialApi.fetchAutomationCredentials.mockResolvedValue([
      credentialMetadata("credential-old", "Existing provider token"),
      credentialMetadata("credential-new", "Replacement provider token"),
    ]);
    credentialApi.assessAutomationCredentialCompatibility.mockImplementation(async (_projectId: string, credentialId: string) => ({
      credentialId, projectId: "project-1", compatible: true, backendReady: true, configured: true, active: true,
      projectAccess: true, kindAllowed: true, capabilitiesAllowed: true, missingCapabilities: [], issues: [], metadata: null,
    }));
    return {
      current: () => canonical,
      updateFromPatch: (input: { graph: typeof credentialFlow.graph }) => {
        canonical = { ...canonical, graph: input.graph, version: canonical.version + 1, updatedAt: "2026-01-01T00:01:00.000Z" };
        return canonical;
      },
      replace: (next: typeof credentialFlow) => { canonical = next; },
    };
  };
  beforeEach(() => { api.patchNodeFlowDraft.mockReset(); api.fetchNodeFlow.mockReset(); });
  beforeEach(() => { api.validateNodeFlowDraft.mockResolvedValue(review); });
  beforeEach(() => { window.localStorage.clear(); api.fetchNodeFlows.mockResolvedValue({ flows: [flow] }); api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [{ type: "input", version: 1, executable: true, executionKind: "local", label: "Input", description: "Input", category: "Core", credentials: [], capabilities: [], sideEffect: "none", ports: [] }] }); api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] }); api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] }); api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] }); api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] }); api.fetchNodeFlowAgentSkills.mockResolvedValue([]); api.attachNodeFlowToAgent.mockResolvedValue(attachment); api.detachNodeFlowFromAgent.mockResolvedValue(undefined); agentApi.fetchAgentPresets.mockResolvedValue([agent]); api.fetchNodeDefinition.mockResolvedValue({ type: "input", version: 1, executable: true, executionKind: "local", configurationSchema: { type: "object" }, ui: { label: "Input", description: "Input", category: "Core", widgetSchema: { fields: [] } }, ports: [], credentials: [], capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false } }); credentialApi.fetchAutomationCredentials.mockResolvedValue([]); credentialApi.fetchCredentialHealth.mockResolvedValue({ available: true, secure: true, provider: "secure", keyId: "key", keyVersion: 1 }); credentialApi.assessAutomationCredentialCompatibility.mockResolvedValue({ credentialId: "credential-1", projectId: "project-1", compatible: true, backendReady: true, configured: true, active: true, projectAccess: true, kindAllowed: true, capabilitiesAllowed: true, missingCapabilities: [], issues: [], metadata: null }); });
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
  });

  it("keeps the inspector renderable if an older backend returns a flattened definition", async () => {
    api.fetchNodeDefinition.mockResolvedValueOnce({
      type: "input", version: 1, executable: true, executionKind: "local", label: "Input",
      description: "Input", category: "Core", ports: [], credentials: [], capabilities: [], sideEffect: "none",
    });

    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    expect(await screen.findByRole("heading", { name: "Input" })).toBeInTheDocument();
    expect(screen.getByText("input · v1")).toBeInTheDocument();
  });

  it("loads existing metadata-only flow attachments", async () => {
    api.fetchNodeFlowAgentSkills.mockResolvedValue([attachment]);
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    expect(await screen.findByText("Release skill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detach Release Agent" })).toBeInTheDocument();
    expect(screen.queryByText("PRIVATE AGENT INSTRUCTIONS")).not.toBeInTheDocument();
  });

  it("attaches the selected agent from the keyboard and refreshes attachments", async () => {
    const user = userEvent.setup();
    let isAttached = false;
    api.fetchNodeFlowAgentSkills.mockImplementation(async () => isAttached ? [attachment] : []);
    api.attachNodeFlowToAgent.mockImplementation(async () => { isAttached = true; return attachment; });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    const select = await screen.findByRole("button", { name: "Agent preset" });
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Release Agent" }));
    const attachButton = screen.getByRole("button", { name: "Attach node flow to agent" });
    attachButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(api.attachNodeFlowToAgent).toHaveBeenCalledWith("flow-1", { agentPresetId: "agent-1" }));
    expect(await screen.findByText("Release skill")).toBeInTheDocument();
    expect(select).toHaveValue("");
  });

  it("detaches an existing agent and refreshes the empty state", async () => {
    const user = userEvent.setup();
    let isAttached = true;
    api.fetchNodeFlowAgentSkills.mockImplementation(async () => isAttached ? [attachment] : []);
    api.detachNodeFlowFromAgent.mockImplementation(async () => { isAttached = false; });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    const detachButton = await screen.findByRole("button", { name: "Detach Release Agent" });
    await waitFor(() => expect(detachButton).toBeEnabled());
    await user.click(detachButton);

    await waitFor(() => expect(api.detachNodeFlowFromAgent).toHaveBeenCalledWith("flow-1", "agent-1"));
    expect(await screen.findByText("No agents attached.")).toBeInTheDocument();
  });

  it("clears stale attachment state when the selected project changes", async () => {
    let firstAgentSignal: AbortSignal | undefined;
    let firstAttachmentSignal: AbortSignal | undefined;
    const secondFlow = { ...flow, id: "flow-2", projectId: "project-2", title: "Quality automation" };
    const secondAgent = { ...agent, id: "agent-2", projectId: "project-2", name: "Quality Agent" };
    const secondAttachment = { ...attachment, flowId: "flow-2", projectId: "project-2", agentPresetId: "agent-2", skillName: "Quality skill" };
    api.fetchNodeFlows.mockImplementation(async (projectId: string) => ({ flows: [projectId === "project-1" ? flow : secondFlow] }));
    agentApi.fetchAgentPresets.mockImplementation(async (projectId: string, signal?: AbortSignal) => {
      if (projectId === "project-1") firstAgentSignal = signal;
      return [projectId === "project-1" ? agent : secondAgent];
    });
    api.fetchNodeFlowAgentSkills.mockImplementation(async (flowId: string, signal?: AbortSignal) => {
      if (flowId === "flow-1") firstAttachmentSignal = signal;
      return [flowId === "flow-1" ? attachment : secondAttachment];
    });
    const rendered = render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    expect(await screen.findByText("Release skill")).toBeInTheDocument();

    const secondContext = { ...context, projects: [{ id: "project-2", name: "Second project" }], selectedProjectId: "project-2", selectedProject: { id: "project-2", name: "Second project" } };
    rendered.rerender(<ProjectDataContext.Provider value={secondContext as never}><NodesPage /></ProjectDataContext.Provider>);

    expect(await screen.findByText("Quality skill")).toBeInTheDocument();
    expect(screen.queryByText("Release skill")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agent preset" }));
    expect(screen.getByRole("option", { name: "Quality Agent" })).toBeInTheDocument();
    expect(firstAgentSignal?.aborted).toBe(true);
    expect(firstAttachmentSignal?.aborted).toBe(true);
  });

  it("shows attachment loading and recovers from failed agent API calls", async () => {
    const user = userEvent.setup();
    let resolveAttachments: ((value: typeof attachment[]) => void) | undefined;
    api.fetchNodeFlowAgentSkills.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
    agentApi.fetchAgentPresets.mockRejectedValueOnce(new Error("Agent service unavailable")).mockResolvedValueOnce([agent]);
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    expect(await screen.findByText("Loading agent attachments…")).toBeInTheDocument();
    resolveAttachments?.([]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Agent service unavailable");
    await user.click(screen.getByRole("button", { name: "Retry attachments" }));

    const select = await screen.findByRole("button", { name: "Agent preset" });
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(select);
    expect(await screen.findByRole("option", { name: "Release Agent" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Agent service unavailable")).not.toBeInTheDocument());
  });

  it("keeps a failed mutation visible and preserves the selected agent for retry", async () => {
    const user = userEvent.setup();
    api.attachNodeFlowToAgent.mockRejectedValueOnce(new Error("Attachment denied"));
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    const select = await screen.findByRole("button", { name: "Agent preset" });
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Release Agent" }));
    await user.click(screen.getByRole("button", { name: "Attach node flow to agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Attachment denied");
    expect(select).toHaveValue("agent-1");
  });

  it("imports legacy localStorage once and removes it as a source of truth", async () => {
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, nodes: [{ id: "input-1", type: "input", title: "Input", position: { x: 1, y: 1 } }], edges: [] }));
    api.createNodeFlowDraft.mockResolvedValue({ flowId: "imported", draftRevision: 1 });
    api.fetchNodeFlows.mockResolvedValueOnce({ flows: [] }).mockResolvedValueOnce({ flows: [flow] });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await waitFor(() => expect(api.createNodeFlowDraft).toHaveBeenCalledTimes(1));
    expect(api.createNodeFlowDraft.mock.calls[0]?.[1].graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      "set_fields", "condition", "output", "provider_prompt", "input",
    ]);
    expect(window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("codeux:nodes-canvas:imported:project-1")).toBe("imported");
  });

  it("keeps backend flows usable when a legacy canvas import fails", async () => {
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, JSON.stringify({ nodes: [{ id: "trigger-1", kind: "trigger" }], edges: [] }));
    api.createNodeFlowDraft.mockRejectedValueOnce(new Error("Legacy import rejected"));

    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    expect(await screen.findByText("Release automation")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Existing backend flows remain available");
    expect(window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY)).not.toBeNull();
  });

  it("ignores a stale validation response after selecting another flow", async () => {
    const user = userEvent.setup();
    const secondFlow = { ...flow, id: "flow-2", title: "Quality automation", version: 7 };
    let resolveSecondReview: ((value: typeof review) => void) | undefined;
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow, secondFlow] });
    api.validateNodeFlowDraft
      .mockResolvedValueOnce(review)
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecondReview = resolve; }))
      .mockResolvedValueOnce({ ...review, draftRevision: 9 });

    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await user.click((await screen.findByText("Quality automation")).closest("button")!);
    await user.click(screen.getByText("Release automation").closest("button")!);

    expect(await screen.findByText(/Draft r9/)).toBeInTheDocument();
    resolveSecondReview?.({ ...review, flowId: "flow-2", name: "Quality automation", draftRevision: 7 });
    await Promise.resolve();

    expect(screen.queryByText(/Draft r7/)).not.toBeInTheDocument();
    expect(screen.getByText(/Draft r9/)).toBeInTheDocument();
  });

  it("surfaces optimistic save conflicts", async () => {
    const user = userEvent.setup(); api.patchNodeFlowDraft.mockResolvedValue({ conflict: { message: "The draft changed after it was read; reload the summary and reapply the patch.", actualDraftRevision: 3 } });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);
    await screen.findByText("Release automation");
    await user.type(screen.getAllByLabelText("Description")[0]!, " changed");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current revision is 3");
  });

  it("binds a compatible credential immediately and refreshes the canonical review", async () => {
    const user = userEvent.setup();
    const state = setupCredentialFlow();
    api.patchNodeFlowDraft.mockImplementation(async (_flowId: string, input: { graph: typeof credentialFlow.graph }) => {
      const saved = state.updateFromPatch(input);
      return { draft: credentialReview(saved) };
    });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    await user.click(await screen.findByRole("button", { name: "Choose credential for Provider connection" }));
    await user.click(await screen.findByRole("menuitem", { name: /Replacement provider token/ }));

    await waitFor(() => expect(api.patchNodeFlowDraft).toHaveBeenCalledTimes(1));
    const patchInput = api.patchNodeFlowDraft.mock.calls[0]?.[1];
    expect(patchInput).toMatchObject({ projectId: "project-1", draftRevision: 2 });
    expect(patchInput.graph.nodes[0]).toMatchObject({
      data: { prompt: "Keep this configuration" },
      credentialBindings: [
        { slot: "audit", credentialId: "credential-audit" },
        { slot: "provider", credentialId: "credential-new" },
      ],
    });
    expect(await screen.findByText("Credential binding saved and draft review refreshed.")).toBeInTheDocument();
    expect(api.fetchNodeFlow).toHaveBeenCalledWith("flow-1");
    expect(api.validateNodeFlowDraft).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent("hidden-key");
  });

  it("rebinds and explicitly unbinds one slot without changing sibling bindings or node data", async () => {
    const user = userEvent.setup();
    const initiallyBound = {
      ...credentialFlow,
      graph: {
        ...credentialFlow.graph,
        nodes: [{
          ...credentialFlow.graph.nodes[0]!,
          credentialBindings: [
            { slot: "audit", credentialId: "credential-audit" },
            { slot: "provider", credentialId: "credential-old" },
          ],
        }],
      },
    };
    const state = setupCredentialFlow(initiallyBound);
    api.patchNodeFlowDraft.mockImplementation(async (_flowId: string, input: { graph: typeof credentialFlow.graph }) => {
      const saved = state.updateFromPatch(input);
      return { draft: credentialReview(saved) };
    });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    await user.click(await screen.findByRole("button", { name: "Choose credential for Provider connection" }));
    await user.click(await screen.findByRole("menuitem", { name: /Replacement provider token/ }));
    expect(await screen.findByText("Credential binding saved and draft review refreshed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose credential for Provider connection" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove Replacement provider token binding/ }));

    expect(await screen.findByText("Credential binding removed and draft review refreshed.")).toBeInTheDocument();
    const unbindInput = api.patchNodeFlowDraft.mock.calls[1]?.[1];
    expect(unbindInput).toMatchObject({ draftRevision: 3 });
    expect(unbindInput.graph.nodes[0]).toMatchObject({
      data: { prompt: "Keep this configuration" },
      credentialBindings: [{ slot: "audit", credentialId: "credential-audit" }],
    });
  });

  it("refreshes a conflicted draft, keeps the slot picker open, and requires an explicit retry", async () => {
    const user = userEvent.setup();
    const state = setupCredentialFlow();
    const latest = {
      ...credentialFlow,
      version: 3,
      graph: {
        ...credentialFlow.graph,
        nodes: [{ ...credentialFlow.graph.nodes[0]!, data: { prompt: "Sibling edit from latest draft" } }],
      },
    };
    api.patchNodeFlowDraft.mockResolvedValueOnce({
      conflict: { code: "draft_revision_conflict", flowId: "flow-1", expectedDraftRevision: 2, actualDraftRevision: 3, message: "The draft changed after it was read; reload the summary and reapply the patch." },
    }).mockImplementationOnce(async (_flowId: string, input: { graph: typeof credentialFlow.graph }) => {
      const saved = state.updateFromPatch(input);
      return { draft: credentialReview(saved) };
    });
    let fetchCount = 0;
    api.fetchNodeFlow.mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) { state.replace(latest); return latest; }
      return state.current();
    });
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    await user.click(await screen.findByRole("button", { name: "Choose credential for Provider connection" }));
    await user.click(await screen.findByRole("menuitem", { name: /Replacement provider token/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("choose the credential again to retry");
    expect(api.patchNodeFlowDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu", { name: "Credential picker for Provider connection" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /Replacement provider token/ }));
    expect(await screen.findByText("Credential binding saved and draft review refreshed.")).toBeInTheDocument();
    expect(api.patchNodeFlowDraft.mock.calls[1]?.[1]).toMatchObject({ draftRevision: 3 });
    expect(api.patchNodeFlowDraft.mock.calls[1]?.[1].graph.nodes[0].data).toEqual({ prompt: "Sibling edit from latest draft" });
  });

  it("announces policy denial without presenting the requested status as saved", async () => {
    const user = userEvent.setup();
    setupCredentialFlow();
    api.patchNodeFlowDraft.mockRejectedValueOnce(new Error("Policy denied this project change"));
    render(<ProjectDataContext.Provider value={context as never}><NodesPage /></ProjectDataContext.Provider>);

    await user.click(await screen.findByRole("button", { name: "Choose credential for Provider connection" }));
    await user.click(await screen.findByRole("menuitem", { name: /Replacement provider token/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("policy denied the change");
    expect(screen.queryByText("Request binding")).not.toBeInTheDocument();
    expect(screen.queryByText("Credential binding saved and draft review refreshed.")).not.toBeInTheDocument();
  });
});
