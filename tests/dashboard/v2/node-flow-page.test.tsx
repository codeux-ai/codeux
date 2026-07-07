/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import type { NodeFlowRecord } from "../../../dashboard/src/v2/types.js";
import {
  attachNodeFlowToAgent,
  createNodeFlow,
  fetchNodeFlowAgentSkills,
  fetchNodeFlowNodeRuns,
  fetchNodeFlowRuns,
  fetchNodeFlows,
  runNodeFlow,
  updateNodeFlow,
  validateNodeFlow,
} from "../../../dashboard/src/v2/lib/node-flow-api.js";
import { fetchAgentPresets } from "../../../dashboard/src/v2/lib/agent-preset-api.js";

vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", () => ({
  attachNodeFlowToAgent: vi.fn(),
  createNodeFlow: vi.fn(),
  deleteNodeFlow: vi.fn(),
  detachNodeFlowFromAgent: vi.fn(),
  fetchNodeFlowAgentSkills: vi.fn(),
  fetchNodeFlowNodeRuns: vi.fn(),
  fetchNodeFlowRuns: vi.fn(),
  fetchNodeFlows: vi.fn(),
  runNodeFlow: vi.fn(),
  updateNodeFlow: vi.fn(),
  validateNodeFlow: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
    selectionMovement: { duration: "0ms", ease: "linear" },
  })),
}));

const flow: NodeFlowRecord = {
  id: "flow-1",
  projectId: "project-1",
  title: "Release Gate",
  description: "Checks release inputs",
  version: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  graph: {
    nodes: [
      {
        id: "trigger",
        type: "input",
        title: "Run Input",
        description: "Start here",
        position: { x: 32, y: 64 },
        widgetSchema: {
          fields: [
            { id: "branch", type: "text", label: "Branch", defaultValue: "dev" },
            { id: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
          ],
        },
        data: { branch: "dev", enabled: true },
      },
    ],
    edges: [],
    inputSchema: {
      fields: [{ id: "payload", type: "json", label: "Payload", defaultValue: { release: true } }],
    },
  },
};

const projectContext = {
  projects: [{ id: "project-1", name: "Test Project", status: "ready" }],
  selectedProjectId: "project-1",
  selectedProject: { id: "project-1", name: "Test Project", status: "ready" },
  loading: false,
  error: null,
  refreshProjects: vi.fn(),
  selectProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
};

const renderPage = (context: any = projectContext) => render(
  <ProjectDataContext.Provider value={context}>
    <NodesPage />
  </ProjectDataContext.Provider>,
);

describe("NodesPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(fetchNodeFlows).mockResolvedValue({ flows: [flow] });
    vi.mocked(fetchAgentPresets).mockResolvedValue([
      { id: "agent-1", name: "Worker", description: "", instructionMarkdown: "" },
    ] as any);
    vi.mocked(fetchNodeFlowAgentSkills).mockResolvedValue([]);
    vi.mocked(fetchNodeFlowRuns).mockResolvedValue({ runs: [] });
    vi.mocked(fetchNodeFlowNodeRuns).mockResolvedValue({ nodeRuns: [] });
    vi.mocked(validateNodeFlow).mockResolvedValue({ valid: true, errors: [], graph: flow.graph, executionOrder: ["trigger"] });
    vi.mocked(updateNodeFlow).mockImplementation(async (_flowId, input) => ({
      ...flow,
      title: input.title ?? flow.title,
      description: input.description ?? flow.description,
      graph: input.graph ?? flow.graph,
      version: 3,
    }));
    vi.mocked(attachNodeFlowToAgent).mockResolvedValue({
      flowId: "flow-1",
      projectId: "project-1",
      agentPresetId: "agent-1",
      skillName: "Release Gate",
      description: "",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    vi.mocked(createNodeFlow).mockResolvedValue({
      ...flow,
      id: "flow-created",
      title: "Untitled Node Flow",
      version: 1,
      graph: {
        nodes: [
          {
            id: "trigger",
            type: "input",
            title: "Run Input",
            description: "Receives dashboard input.",
            position: { x: 56, y: 96 },
            widgetSchema: {
              fields: [{ id: "label", type: "text", label: "Run label", defaultValue: "Manual run" }],
            },
            data: { label: "Manual run" },
          },
        ],
        edges: [],
        inputSchema: {
          fields: [{ id: "payload", type: "json", label: "Payload", defaultValue: {} }],
        },
      },
    });
    vi.mocked(runNodeFlow).mockResolvedValue({
      run: {
        id: "run-1",
        flowId: "flow-1",
        projectId: "project-1",
        version: 2,
        status: "succeeded",
        executionInvocationId: "flow-invocation-1",
        triggerType: "manual",
        triggerPayload: null,
        input: { payload: { release: true } },
        output: null,
        errorMessage: null,
        startedAt: "2026-01-02T00:00:00.000Z",
        finishedAt: "2026-01-02T00:00:01.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:01.000Z",
      },
      nodeRuns: [
        {
          id: "node-run-local-1",
          runId: "run-1",
          flowId: "flow-1",
          projectId: "project-1",
          nodeId: "trigger",
          status: "succeeded",
          executionInvocationId: "external-invocation-1",
          input: { payload: { release: true } },
          output: { accepted: true },
          errorMessage: null,
          startedAt: "2026-01-02T00:00:00.000Z",
          finishedAt: "2026-01-02T00:00:01.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:01.000Z",
        },
      ],
      output: { accepted: true },
    });
  });

  it("renders a project placeholder when no project is selected", () => {
    renderPage({ ...projectContext, selectedProjectId: null, selectedProject: null });

    expect(screen.getByText("Select a project to edit node workflows.")).toBeInTheDocument();
    expect(fetchNodeFlows).not.toHaveBeenCalled();
  });

  it("loads project flows and renders the editor surface", async () => {
    renderPage();

    expect(await screen.findByText("Workflow Nodes")).toBeInTheDocument();
    expect(screen.getByText("Release Gate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select node Run Input/i })).toBeInTheDocument();
    expect(await screen.findByLabelText("Branch")).toHaveValue("dev");
    expect(screen.getByRole("button", { name: /Run Flow/i })).toBeInTheDocument();
  });

  it("validates and saves edited flow data", async () => {
    renderPage();

    await screen.findByText("Workflow Nodes");
    fireEvent.input(screen.getByLabelText(/Flow title/i), { target: { value: "Release Gate Updated" } });
    fireEvent.click(screen.getByRole("button", { name: /Validate/i }));

    await waitFor(() => {
      expect(validateNodeFlow).toHaveBeenCalledWith("flow-1", expect.objectContaining({ nodes: expect.any(Array) }));
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Node/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(updateNodeFlow).toHaveBeenCalledWith("flow-1", expect.objectContaining({
        graph: expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ type: "set_fields" })]),
        }),
      }));
    });
  });

  it("creates executable starter graphs for new flows", async () => {
    vi.mocked(fetchNodeFlows).mockResolvedValueOnce({ flows: [] });
    renderPage();

    await screen.findByText("No Node Flows");
    fireEvent.click(screen.getAllByRole("button", { name: /Create Node Flow/i })[0]!);

    await waitFor(() => {
      expect(createNodeFlow).toHaveBeenCalledWith("project-1", expect.objectContaining({
        graph: expect.objectContaining({
          nodes: [expect.objectContaining({ id: "trigger", type: "input" })],
        }),
      }));
    });
  });

  it("attaches agents and launches manual runs", async () => {
    renderPage();

    await screen.findByText("Workflow Nodes");
    const user = userEvent.setup();
    await screen.findByLabelText("Branch");
    await user.selectOptions(screen.getByLabelText("Agent preset"), "agent-1");
    await waitFor(() => expect(screen.getByLabelText("Agent preset")).toHaveValue("agent-1"));
    await user.click(screen.getByRole("button", { name: /Attach node flow to agent/i }));

    await waitFor(() => {
      expect(attachNodeFlowToAgent).toHaveBeenCalledWith("flow-1", { agentPresetId: "agent-1" });
    });
    await waitFor(() => expect(screen.getAllByText("Worker").length).toBeGreaterThan(1));

    await user.click(screen.getByRole("button", { name: /Run Flow/i }));

    await waitFor(() => {
      expect(runNodeFlow).toHaveBeenCalledWith("flow-1", {
        projectId: "project-1",
        input: expect.objectContaining({ payload: { release: true } }),
      });
    });
    const history = screen.getAllByText(/succeeded/i)
      .map((entry) => entry.closest("button"))
      .find(Boolean);
    expect(history).toBeInTheDocument();
    expect(screen.getByText("Invocation external-invocation-1")).toBeInTheDocument();
    expect(screen.queryByText("Invocation node-run-local-1")).not.toBeInTheDocument();
    expect(screen.getByText(/"accepted": true/)).toBeInTheDocument();
  });

  it("renders validation errors from the backend", async () => {
    vi.mocked(validateNodeFlow).mockResolvedValueOnce({
      valid: false,
      errors: [{ field: "nodes[0].title", code: "required", message: "Node title is required." }],
    });
    renderPage();

    await screen.findByText("Workflow Nodes");
    fireEvent.click(screen.getByRole("button", { name: /Validate/i }));

    const alert = (await screen.findAllByRole("alert")).find((element) => element.textContent?.includes("Node title is required."));
    if (!alert) {
      throw new Error("Expected validation alert");
    }
    expect(within(alert).getByText(/Node title is required/i)).toBeInTheDocument();
  });
});
