/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODES_CANVAS_STORAGE_KEY, NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import { DashboardI18nProvider, type DashboardLocale } from "../../../dashboard/src/v2/i18n/index.js";

const api = vi.hoisted(() => ({ fetchNodeFlows: vi.fn(), fetchNodeFlowCatalog: vi.fn(), createNodeFlowDraft: vi.fn(), fetchNodeFlow: vi.fn(), fetchNodeFlowRuns: vi.fn(), fetchNodeFlowNodeRuns: vi.fn(), fetchNodeFlowAttempts: vi.fn(), fetchNodeFlowApprovals: vi.fn(), fetchNodeFlowAgentSkills: vi.fn(), attachNodeFlowToAgent: vi.fn(), detachNodeFlowFromAgent: vi.fn(), decideNodeFlowApproval: vi.fn(), patchNodeFlowDraft: vi.fn(), fetchNodeDefinition: vi.fn(), validateNodeFlowDraft: vi.fn(), runNodeFlow: vi.fn(), deleteNodeFlow: vi.fn() }));
const agentApi = vi.hoisted(() => ({ fetchAgentPresets: vi.fn() }));
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", async (original) => ({ ...(await original()), ...api }));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", async (original) => ({ ...(await original()), ...agentApi }));
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));

const flow = { id: "flow-1", projectId: "project-1", title: "Release automation", description: "Governed", graph: { schemaVersion: 2 as const, nodes: [{ id: "input-1", type: "input", title: "Input", definition: { type: "input", version: 1 }, position: { x: 40, y: 40 } }], edges: [] }, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const agent = { id: "agent-1", projectId: "project-1", name: "Release Agent", description: "Release helper", instructionMarkdown: "PRIVATE AGENT INSTRUCTIONS", labels: [], sourcePath: null, sourceScope: null, sourceUpdatedAt: null, sourceImportedAt: null, sourceExists: false, syncStatus: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const attachment = { flowId: "flow-1", projectId: "project-1", agentPresetId: "agent-1", skillName: "Release skill", description: "Governed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const context = { projects: [{ id: "project-1", name: "Test project" }], selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "Test project" }, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined };

const renderPage = (value: typeof context = context, locale: DashboardLocale = "en") => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}>
    <ProjectDataContext.Provider value={value as never}><NodesPage /></ProjectDataContext.Provider>
  </DashboardI18nProvider>,
);

describe("NodesPage governed workspace", () => {
  const review = { flowId: "flow-1", projectId: "project-1", name: "Release automation", description: "Governed", draftRevision: 2, nodeCount: 1, edgeCount: 0, valid: true, validationIssues: [], policyFindings: [], requiredCredentials: [], requestedCapabilities: [], sideEffectDiffs: [], publishedVersion: 1 };
  beforeEach(() => { api.validateNodeFlowDraft.mockResolvedValue(review); });
  beforeEach(() => { window.localStorage.clear(); api.fetchNodeFlows.mockResolvedValue({ flows: [flow] }); api.fetchNodeFlowCatalog.mockResolvedValue({ nodes: [{ type: "input", version: 1, executable: true, executionKind: "local", label: "Input", description: "Input", category: "Core", credentials: [], capabilities: [], sideEffect: "none", ports: [] }] }); api.fetchNodeFlow.mockResolvedValue(flow); api.createNodeFlowDraft.mockResolvedValue(review); api.patchNodeFlowDraft.mockResolvedValue({ draft: review }); api.runNodeFlow.mockResolvedValue({ run: { id: "run-1", flowId: "flow-1", projectId: "project-1", version: 1, publicationId: "publication-1", status: "succeeded", policy: {}, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: null, triggerType: "manual", triggerPayload: null, input: {}, output: { providerMessage: "PROVIDER_OUTPUT_VERBATIM" }, errorMessage: null, startedAt: null, finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, nodeRuns: [], attempts: [] }); api.fetchNodeFlowRuns.mockResolvedValue({ runs: [] }); api.fetchNodeFlowNodeRuns.mockResolvedValue({ nodeRuns: [] }); api.fetchNodeFlowAttempts.mockResolvedValue({ attempts: [] }); api.fetchNodeFlowApprovals.mockResolvedValue({ approvals: [] }); api.fetchNodeFlowAgentSkills.mockResolvedValue([]); api.attachNodeFlowToAgent.mockResolvedValue(attachment); api.detachNodeFlowFromAgent.mockResolvedValue(undefined); agentApi.fetchAgentPresets.mockResolvedValue([agent]); api.fetchNodeDefinition.mockResolvedValue({ type: "input", version: 1, executable: true, executionKind: "local", configurationSchema: { type: "object" }, ui: { label: "Input", description: "Input", category: "Core", widgetSchema: { fields: [] } }, ports: [], credentials: [], capabilities: [], sideEffect: "none", defaultPolicy: {}, documentation: "", deprecation: { deprecated: false } }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("loads a project flow library and registry-backed editor", async () => {
    renderPage();
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

    renderPage();

    expect(await screen.findByRole("heading", { name: "Input" })).toBeInTheDocument();
    expect(screen.getByText("input · v1")).toBeInTheDocument();
  });

  it("loads existing metadata-only flow attachments", async () => {
    api.fetchNodeFlowAgentSkills.mockResolvedValue([attachment]);
    renderPage();

    expect(await screen.findByText("Release skill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detach Release Agent" })).toBeInTheDocument();
    expect(screen.queryByText("PRIVATE AGENT INSTRUCTIONS")).not.toBeInTheDocument();
  });

  it("attaches the selected agent from the keyboard and refreshes attachments", async () => {
    const user = userEvent.setup();
    let isAttached = false;
    api.fetchNodeFlowAgentSkills.mockImplementation(async () => isAttached ? [attachment] : []);
    api.attachNodeFlowToAgent.mockImplementation(async () => { isAttached = true; return attachment; });
    renderPage();

    const select = await screen.findByRole("combobox", { name: "Agent preset" });
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "agent-1");
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
    renderPage();

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
    const rendered = renderPage();
    expect(await screen.findByText("Release skill")).toBeInTheDocument();

    const secondContext = { ...context, projects: [{ id: "project-2", name: "Second project" }], selectedProjectId: "project-2", selectedProject: { id: "project-2", name: "Second project" } };
    rendered.rerender(<DashboardI18nProvider storage={null}><ProjectDataContext.Provider value={secondContext as never}><NodesPage /></ProjectDataContext.Provider></DashboardI18nProvider>);

    expect(await screen.findByText("Quality skill")).toBeInTheDocument();
    expect(screen.queryByText("Release skill")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Quality Agent" })).toBeInTheDocument();
    expect(firstAgentSignal?.aborted).toBe(true);
    expect(firstAttachmentSignal?.aborted).toBe(true);
  });

  it("shows attachment loading and recovers from failed agent API calls", async () => {
    const user = userEvent.setup();
    let resolveAttachments: ((value: typeof attachment[]) => void) | undefined;
    api.fetchNodeFlowAgentSkills.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
    agentApi.fetchAgentPresets.mockRejectedValueOnce(new Error("Agent service unavailable")).mockResolvedValueOnce([agent]);
    renderPage();

    expect(await screen.findByText("Loading agent attachments…")).toBeInTheDocument();
    resolveAttachments?.([]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Agent service unavailable");
    await user.click(screen.getByRole("button", { name: "Retry attachments" }));

    expect(await screen.findByRole("option", { name: "Release Agent" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Agent service unavailable")).not.toBeInTheDocument());
  });

  it("keeps a failed mutation visible and preserves the selected agent for retry", async () => {
    const user = userEvent.setup();
    api.attachNodeFlowToAgent.mockRejectedValueOnce(new Error("Attachment denied"));
    renderPage();

    const select = await screen.findByRole("combobox", { name: "Agent preset" });
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "agent-1");
    await user.click(screen.getByRole("button", { name: "Attach node flow to agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Attachment denied");
    expect(select).toHaveValue("agent-1");
  });

  it("imports legacy localStorage once and removes it as a source of truth", async () => {
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, nodes: [{ id: "input-1", type: "input", title: "Input", position: { x: 1, y: 1 } }], edges: [] }));
    api.createNodeFlowDraft.mockResolvedValue({ flowId: "imported", draftRevision: 1 });
    api.fetchNodeFlows.mockResolvedValueOnce({ flows: [] }).mockResolvedValueOnce({ flows: [flow] });
    renderPage(context, "de");
    await waitFor(() => expect(api.createNodeFlowDraft).toHaveBeenCalledTimes(1));
    expect(api.createNodeFlowDraft.mock.calls[0]?.[1].graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      "set_fields", "condition", "output", "provider_prompt", "input",
    ]);
    expect(window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("codeux:nodes-canvas:imported:project-1")).toBe("imported");
    expect(screen.getByText(/einmalig in die Backend-Flow-Bibliothek/)).toBeInTheDocument();
  });

  it("keeps backend flows usable when a legacy canvas import fails", async () => {
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, JSON.stringify({ nodes: [{ id: "trigger-1", kind: "trigger" }], edges: [] }));
    api.createNodeFlowDraft.mockRejectedValueOnce(new Error("Legacy import rejected"));

    renderPage(context, "de");

    expect(await screen.findByText("Release automation")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Vorhandene Backend-Flows bleiben verfügbar");
    expect(screen.getByRole("alert")).toHaveTextContent("Legacy import rejected");
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

    renderPage();
    await user.click((await screen.findByText("Quality automation")).closest("button")!);
    await user.click(screen.getByText("Release automation").closest("button")!);

    expect(await screen.findByText(/Draft r9/)).toBeInTheDocument();
    resolveSecondReview?.({ ...review, flowId: "flow-2", name: "Quality automation", draftRevision: 7 });
    await Promise.resolve();

    expect(screen.queryByText(/Draft r7/)).not.toBeInTheDocument();
    expect(screen.getByText(/Draft r9/)).toBeInTheDocument();
  });

  it("ignores stale run history after switching flows in German", async () => {
    const user = userEvent.setup();
    const secondFlow = { ...flow, id: "flow-2", title: "Quality automation", version: 7 };
    let resolveFirstRuns: ((value: { runs: Array<Record<string, unknown>> }) => void) | undefined;
    api.fetchNodeFlows.mockResolvedValue({ flows: [flow, secondFlow] });
    api.fetchNodeFlowRuns.mockImplementation(async (flowId: string) => {
      if (flowId === "flow-1") {
        return new Promise((resolve) => { resolveFirstRuns = resolve; });
      }
      return { runs: [] };
    });

    renderPage(context, "de");
    await user.click((await screen.findByText("Quality automation")).closest("button")!);
    await waitFor(() => expect(api.fetchNodeFlowRuns).toHaveBeenCalledWith("flow-2"));

    resolveFirstRuns?.({ runs: [{
      id: "stale-run-id", flowId: "flow-1", projectId: "project-1", version: 1,
      publicationId: null, status: "failed", policy: {}, leaseOwner: null, leaseExpiresAt: null,
      heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: null, triggerType: "manual",
      triggerPayload: null, input: {}, output: {}, errorMessage: null, startedAt: null, finishedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }] });
    await Promise.resolve();

    expect(screen.queryByText("stale-run-id")).not.toBeInTheDocument();
    expect(screen.getByText("Keine gespeicherten Ausführungen.")).toBeInTheDocument();
  });

  it("surfaces optimistic save conflicts", async () => {
    const user = userEvent.setup(); api.patchNodeFlowDraft.mockResolvedValue({ conflict: { message: "The draft changed after it was read; reload the summary and reapply the patch.", actualDraftRevision: 3 } });
    renderPage();
    await screen.findByText("Release automation");
    await user.type(screen.getAllByLabelText("Description")[0]!, " changed");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current revision is 3");
  });

  it("supports the German edit, validate, run, debug, and schedule path without changing payload values", async () => {
    const user = userEvent.setup();
    renderPage(context, "de");

    expect(await screen.findByRole("heading", { name: "Automatisierungsbereich" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node-Katalog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planen" })).toHaveAttribute("href", "/scheduler");

    const flowName = screen.getByLabelText("Flow-Name");
    await user.clear(flowName);
    await user.type(flowName, "German UI, stable graph");
    await user.click(screen.getByRole("button", { name: "Entwurf speichern" }));

    expect(api.patchNodeFlowDraft).toHaveBeenCalledWith("flow-1", expect.objectContaining({
      projectId: "project-1",
      title: "German UI, stable graph",
      graph: flow.graph,
    }));

    await user.click(screen.getByRole("button", { name: "Validieren" }));
    expect(api.validateNodeFlowDraft).toHaveBeenCalledWith("project-1", "flow-1");

    await user.click(screen.getByRole("button", { name: "Veröffentlichung ausführen" }));
    expect(api.runNodeFlow).toHaveBeenCalledWith("flow-1", { projectId: "project-1", input: {} });
    expect(await screen.findByText(/PROVIDER_OUTPUT_VERBATIM/)).toBeInTheDocument();
    expect(screen.getByText("Erfolgreich · v1")).toBeInTheDocument();
  });

  it("keeps stable English draft defaults when creating from the German interface", async () => {
    const user = userEvent.setup();
    renderPage(context, "de");

    await user.click(await screen.findByRole("button", { name: "Neuer Entwurf" }));

    expect(api.createNodeFlowDraft).toHaveBeenCalledWith("project-1", expect.objectContaining({
      title: "Untitled automation",
      description: "",
      graph: expect.objectContaining({
        nodes: [expect.objectContaining({ id: "trigger", type: "input", title: "Run Input", data: { label: "Manual run" } })],
      }),
    }));
  });

  it("shows provider diagnostics verbatim beside German recovery controls", async () => {
    const user = userEvent.setup();
    api.runNodeFlow.mockRejectedValueOnce(new Error("PROVIDER_NETWORK_DIAGNOSTIC_503"));
    renderPage(context, "de");

    await user.click(await screen.findByRole("button", { name: "Veröffentlichung ausführen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("PROVIDER_NETWORK_DIAGNOSTIC_503");
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});
