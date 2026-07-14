/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "preact";
import {
  createInitialNodeCanvasGraph,
  nodesCanvasReducer,
  validateNodeCanvasGraph,
  type NodeCanvasGraph,
  type NodeCanvasNode,
} from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";
import { NodeInspector } from "../../../dashboard/src/v2/components/nodes/NodeInspector.js";
import { NodePalette } from "../../../dashboard/src/v2/components/nodes/NodePalette.js";
import { NodeValidationPanel } from "../../../dashboard/src/v2/components/nodes/NodeValidationPanel.js";
import { NodeFlowInspector } from "../../../dashboard/src/v2/components/nodes/NodeFlowInspector.js";

const credentialApi = vi.hoisted(() => ({
  fetchAutomationCredentials: vi.fn(),
  fetchCredentialHealth: vi.fn(),
  assessAutomationCredentialCompatibility: vi.fn(),
}));
vi.mock("../../../dashboard/src/v2/lib/automation-credential-api.js", () => credentialApi);
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const findNode = (graph: NodeCanvasGraph, nodeId: string): NodeCanvasNode => {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Expected node ${nodeId} to exist.`);
  }
  return node;
};

const renderInspector = (node: NodeCanvasNode | null, graph = createInitialNodeCanvasGraph()) => {
  const onNodeChange = vi.fn();
  const onNodeConfigChange = vi.fn();
  const onNodeEnabledChange = vi.fn();
  render(
    <NodeInspector
      graph={graph}
      selectedNode={node}
      selectedNodeEnabled={true}
      validationIssues={validateNodeCanvasGraph(graph)}
      onNodeChange={onNodeChange}
      onNodeConfigChange={onNodeConfigChange}
      onNodeEnabledChange={onNodeEnabledChange}
    />,
  );

  return { onNodeChange, onNodeConfigChange, onNodeEnabledChange };
};

describe("nodes inspector panels", () => {
  beforeEach(() => {
    credentialApi.fetchCredentialHealth.mockResolvedValue({ available: true, secure: true, provider: "secure", keyId: "key", keyVersion: 1 });
    credentialApi.fetchAutomationCredentials.mockResolvedValue([]);
    credentialApi.assessAutomationCredentialCompatibility.mockResolvedValue({
      credentialId: "credential-1", projectId: "project-1", compatible: true, backendReady: true,
      configured: true, active: true, projectAccess: true, kindAllowed: true, capabilitiesAllowed: true,
      missingCapabilities: [], issues: [], metadata: null,
    });
  });
  it("emits governed registry definitions from the palette", async () => {
    const user = userEvent.setup();
    const onCreateNode = vi.fn();

    const definitions = [{ type: "output", version: 1, executable: true, executionKind: "local" as const, label: "Output", description: "Return output", category: "Core", credentials: [], capabilities: [], sideEffect: "none" as const, ports: [] }];
    render(<NodePalette definitions={definitions} onCreateNode={onCreateNode} />);

    await user.click(screen.getByRole("button", { name: "Add Output node" }));

    expect(onCreateNode).toHaveBeenCalledWith(definitions[0]);
  });

  it("renders an accessible empty-selection state", () => {
    renderInspector(null);

    expect(screen.getByRole("heading", { name: "Nothing selected" })).toBeInTheDocument();
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("emits controlled node, config, intent, and enabled edits", async () => {
    const user = userEvent.setup();
    const graph = createInitialNodeCanvasGraph();
    const agent = findNode(graph, "agent-1");
    const { onNodeChange, onNodeConfigChange, onNodeEnabledChange } = renderInspector(agent, graph);

    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "Implementation Router" } });
    fireEvent.input(screen.getByLabelText("Description"), { target: { value: "Route by task type." } });
    await user.click(screen.getByLabelText("Agent intent"));
    await user.click(screen.getByRole("option", { name: "review" }));
    fireEvent.input(screen.getByLabelText("Agent preset"), { target: { value: "agent-preset-reviewer" } });
    await user.click(screen.getByRole("switch", { name: "Enabled" }));

    expect(onNodeChange).toHaveBeenCalledWith("agent-1", { label: "Implementation Router" });
    expect(onNodeChange).toHaveBeenCalledWith("agent-1", { description: "Route by task type." });
    expect(onNodeChange).toHaveBeenCalledWith("agent-1", {
      metadata: { agentIntent: "review" },
    });
    expect(onNodeConfigChange).toHaveBeenCalledWith("agent-1", "agentPresetId", "agent-preset-reviewer");
    expect(onNodeEnabledChange).toHaveBeenCalledWith("agent-1", false);
  });

  it("marks invalid fields and exposes accessible form labels", () => {
    const graph = nodesCanvasReducer(createInitialNodeCanvasGraph(), {
      type: "update_node_label",
      nodeId: "task-1",
      label: "",
    });
    const task = findNode(graph, "task-1");

    renderInspector(task, graph);

    expect(screen.getByLabelText("Label")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Node label is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Task intent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Task title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Prompt/)).toBeInTheDocument();
  });

  it("shows read-only edge details and node selection shortcuts", async () => {
    const user = userEvent.setup();
    const graph = createInitialNodeCanvasGraph();
    const edge = graph.edges.find((entry) => entry.id === "edge-agent-1-agent-task-1-agent");
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();

    if (!edge) {
      throw new Error("Expected seed edge to exist.");
    }

    render(
      <NodeInspector
        graph={graph}
        selectedEdge={edge}
        onNodeChange={vi.fn()}
        onNodeConfigChange={vi.fn()}
        onSelectEdge={onSelectEdge}
        onSelectNode={onSelectNode}
      />,
    );

    expect(screen.getByRole("heading", { name: "Selected edge" })).toBeInTheDocument();
    expect(screen.getByText("Agent Router / Agent")).toBeInTheDocument();
    expect(screen.getByText("Task Draft / Agent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Source node" }));
    await user.click(screen.getByRole("button", { name: "Select edge" }));

    expect(onSelectNode).toHaveBeenCalledWith("agent-1");
    expect(onSelectEdge).toHaveBeenCalledWith(edge.id);
  });

  it("groups validation issues with actionable select and focus controls", async () => {
    const user = userEvent.setup();
    const graph = {
      ...createInitialNodeCanvasGraph(),
      edges: [
        {
          id: "edge-missing-target",
          source: { nodeId: "trigger-1", portId: "event" },
          target: { nodeId: "missing", portId: "in" },
        },
      ],
    };
    const onSelectEdge = vi.fn();
    const onFocusEdge = vi.fn();

    render(
      <NodeValidationPanel
        graph={graph}
        onSelectEdge={onSelectEdge}
        onFocusEdge={onFocusEdge}
      />,
    );

    expect(screen.getByRole("heading", { name: "1 issue" })).toBeInTheDocument();
    expect(screen.getByText("Edge: edge-missing-target")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText(/Edge target node is missing/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Focus" }));

    expect(onSelectEdge).toHaveBeenCalledWith("edge-missing-target");
    expect(onFocusEdge).toHaveBeenCalledWith("edge-missing-target");
  });

  const credentialNode = {
    id: "provider-1",
    type: "provider_prompt",
    title: "Provider prompt",
    description: "Run a prompt.",
    definition: { type: "provider_prompt", version: 1 },
    data: { prompt: "Public configuration only" },
    credentialBindings: [],
    position: { x: 10, y: 10 },
  };
  const credentialDefinition = {
    type: "provider_prompt", version: 1, executable: true, executionKind: "provider" as const,
    configurationSchema: { type: "object" as const },
    ui: { label: "Provider prompt", description: "Run a prompt.", category: "Providers", widgetSchema: { fields: [] } },
    ports: [], credentials: [{ slot: "provider", label: "Provider connection", required: true, allowedKinds: ["provider"], requiredCapabilities: ["read"] }],
    capabilities: [], sideEffect: "none" as const, defaultPolicy: {}, documentation: "", deprecation: { deprecated: false },
  };
  const renderCredentialInspector = (onCredentialChange = vi.fn(async () => "saved" as const)) => {
    render(
      <NodeFlowInspector
        selectedNode={credentialNode}
        definition={credentialDefinition}
        validation={null}
        requiredCredentials={[]}
        projectId="project-1"
        flowId="flow-1"
        credentialFeedback={null}
        onCredentialChange={onCredentialChange}
        agents={[]}
        attachments={[]}
        attachAgentId=""
        onAttachAgentIdChange={vi.fn()}
        onAttachAgent={vi.fn()}
        onDetachAgent={vi.fn()}
        onNodeChange={vi.fn()}
      />,
    );
    return onCredentialChange;
  };

  it("shows only compatible credentials as selectable and explains unavailable metadata", async () => {
    const user = userEvent.setup();
    credentialApi.fetchAutomationCredentials.mockResolvedValue([
      { id: "credential-good", name: "Provider read token", kind: "provider" },
      { id: "credential-bad", name: "Revoked deployment token", kind: "http", value: "plaintext-canary" },
    ]);
    credentialApi.assessAutomationCredentialCompatibility.mockImplementation(async (_projectId: string, credentialId: string) => credentialId === "credential-good" ? {
      credentialId, projectId: "project-1", compatible: true, backendReady: true, configured: true, active: true,
      projectAccess: true, kindAllowed: true, capabilitiesAllowed: true, missingCapabilities: [], issues: [], metadata: null,
    } : {
      credentialId, projectId: "project-1", compatible: false, backendReady: true, configured: true, active: false,
      projectAccess: true, kindAllowed: false, capabilitiesAllowed: true, missingCapabilities: [], issues: ["not_active", "kind_not_allowed"],
      metadata: { value: "plaintext-canary" },
    });
    renderCredentialInspector();

    await user.click(screen.getByRole("button", { name: "Choose credential for Provider connection" }));

    expect(await screen.findByRole("menuitem", { name: /Provider read token/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Revoked deployment token/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Credential is not active/)).toBeInTheDocument();
    expect(screen.getByText(/Requires one of these kinds: provider/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("plaintext-canary");
  });

  it("blocks selection when secure storage is unavailable and links directly to Settings", async () => {
    const user = userEvent.setup();
    credentialApi.fetchCredentialHealth.mockResolvedValue({ available: false, secure: false, provider: "secure", keyId: null, keyVersion: null, reason: "low-level backend detail" });
    credentialApi.fetchAutomationCredentials.mockResolvedValue([{ id: "credential-1", name: "Provider token", kind: "provider" }]);
    credentialApi.assessAutomationCredentialCompatibility.mockResolvedValue({
      credentialId: "credential-1", projectId: "project-1", compatible: false, backendReady: false, configured: true,
      active: true, projectAccess: true, kindAllowed: true, capabilitiesAllowed: true, missingCapabilities: [],
      issues: ["backend_unavailable"], metadata: null,
    });
    renderCredentialInspector();

    await user.click(screen.getByRole("button", { name: "Choose credential for Provider connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Secure credential storage is unavailable");
    expect(screen.getByRole("menuitem", { name: "Open credential Settings" })).toHaveAttribute("href", "/config");
    expect(screen.queryByRole("menuitem", { name: /Provider token/ })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("low-level backend detail");
  });

  it("supports keyboard selection and Escape while restoring focus to the trigger", async () => {
    const user = userEvent.setup();
    const onCredentialChange = vi.fn(async () => "saved" as const);
    credentialApi.fetchAutomationCredentials.mockResolvedValue([{ id: "credential-1", name: "Provider token", kind: "provider" }]);
    renderCredentialInspector(onCredentialChange);
    const trigger = screen.getByRole("button", { name: "Choose credential for Provider connection" });

    trigger.focus();
    await user.keyboard("{Enter}");
    const option = await screen.findByRole("menuitem", { name: /Provider token/ });
    option.focus();
    await user.keyboard("{Enter}");

    expect(onCredentialChange).toHaveBeenCalledWith("provider-1", "provider", "credential-1");
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard("{Enter}");
    await screen.findByRole("menu", { name: "Credential picker for Provider connection" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
