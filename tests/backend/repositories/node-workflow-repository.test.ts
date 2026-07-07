import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { NodeWorkflowRepository } from "../../../src/repositories/node-workflow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { RepositoryError, ValidationError } from "../../../src/repositories/repository-utils.js";
import type {
  CreateNodeWorkflowInput,
  NodeWorkflowWidgetDefinition,
  NodeWorkflowWidgetValues,
} from "../../../src/contracts/node-workflow-types.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

async function createRepositories(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
  workflowRepository: NodeWorkflowRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-workflow-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  return {
    dir,
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    agentPresetRepository: new AgentPresetRepository(storage),
    workflowRepository: new NodeWorkflowRepository(storage),
  };
}

afterEach(async () => {
  for (const storage of storages.splice(0)) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function allWidgetDefinitions(): NodeWorkflowWidgetDefinition[] {
  return [
    { key: "title", type: "text", label: "Title", required: true, validation: { minLength: 2 }, group: { id: "main", label: "Main", order: 1 } },
    { key: "notes", type: "textarea", label: "Notes", description: "Long-form instructions." },
    { key: "limit", type: "number", label: "Limit", defaultValue: 3, validation: { min: 1, max: 10 } },
    { key: "dryRun", type: "boolean", label: "Dry run", defaultValue: false },
    {
      key: "priority",
      type: "select",
      label: "Priority",
      options: [
        { label: "High", value: "high" },
        { label: "Low", value: "low", description: "Defer when possible." },
      ],
    },
    {
      key: "labels",
      type: "multiselect",
      label: "Labels",
      options: [
        { label: "Backend", value: "backend" },
        { label: "Dashboard", value: "dashboard" },
      ],
    },
    { key: "token", type: "secret", label: "Token" },
    { key: "docsUrl", type: "url", label: "Docs URL" },
    { key: "payload", type: "json", label: "Payload" },
    { key: "script", type: "code", label: "Script", validation: { language: "typescript" } },
    { key: "env", type: "key_value_list", label: "Environment" },
    { key: "file", type: "file_path", label: "File" },
    { key: "directory", type: "directory_path", label: "Directory" },
    { key: "path", type: "path", label: "Path" },
  ];
}

function allWidgetValues(): NodeWorkflowWidgetValues {
  return {
    title: "Build workflow",
    notes: "Run generated specialist nodes.",
    limit: 5,
    dryRun: true,
    priority: "high",
    labels: ["backend", "dashboard"],
    token: "stored-secret-reference",
    docsUrl: "https://example.com/docs",
    payload: { mode: "strict", count: 2 },
    script: "export const value = 1;",
    env: [{ key: "NODE_ENV", value: "test" }],
    file: "src/index.ts",
    directory: "src",
    path: ".code-ux/workflows",
  };
}

function workflowInput(overrides: Partial<CreateNodeWorkflowInput> = {}): CreateNodeWorkflowInput {
  return {
    name: "Specialist workflow",
    description: "Coordinates generated specialist nodes.",
    status: "active",
    version: 2,
    widgetDefinitions: allWidgetDefinitions(),
    widgetValues: allWidgetValues(),
    nodes: [
      {
        id: "plan",
        type: "specialist",
        title: "Plan",
        description: "Create the implementation plan.",
        widgetDefinitions: [
          {
            key: "scope",
            type: "select",
            label: "Scope",
            required: true,
            options: [
              { label: "Small", value: "small" },
              { label: "Large", value: "large" },
            ],
          },
        ],
        widgetValues: { scope: "small" },
        position: { x: 10, y: 20 },
        metadata: { generatedBy: "test" },
      },
      {
        id: "build",
        type: "specialist",
        title: "Build",
        widgetDefinitions: [{ key: "command", type: "text", label: "Command", required: true }],
        widgetValues: { command: "pnpm run build" },
        position: { x: 240, y: 20 },
      },
    ],
    edges: [{ id: "plan-to-build", sourceNodeId: "plan", targetNodeId: "build", label: "then" }],
    metadata: { owner: "runtime" },
    ...overrides,
  };
}

describe("NodeWorkflowRepository", () => {
  it("round-trips workflows, attachments, runs, and step runs", async () => {
    const { dir, storage, projectRepository, agentPresetRepository, workflowRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Node Workflow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const agent = agentPresetRepository.createAgentPreset(project.id, {
      name: "Builder",
      instructionMarkdown: "Build workflow steps.",
    });

    const workflow = workflowRepository.createWorkflow(project.id, workflowInput());
    expect(workflow).toMatchObject({
      projectId: project.id,
      name: "Specialist workflow",
      status: "active",
      version: 2,
      widgetValues: allWidgetValues(),
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "plan", widgetValues: { scope: "small" } }),
        expect.objectContaining({ id: "build", widgetValues: { command: "pnpm run build" } }),
      ]),
      edges: [{ id: "plan-to-build", sourceNodeId: "plan", targetNodeId: "build", label: "then" }],
    });
    expect(workflowRepository.listWorkflows(project.id).map((item) => item.id)).toEqual([workflow.id]);
    expect(workflowRepository.getWorkflow(project.id, workflow.id)?.widgetDefinitions.map((field) => field.type)).toEqual(
      allWidgetDefinitions().map((field) => field.type),
    );

    const updatedWorkflow = workflowRepository.updateWorkflow(project.id, workflow.id, {
      status: "draft",
      widgetValues: { ...workflow.widgetValues, priority: "low" },
    });
    expect(updatedWorkflow.status).toBe("draft");
    expect(updatedWorkflow.widgetValues.priority).toBe("low");

    const attachment = workflowRepository.attachAgent(project.id, workflow.id, {
      nodeId: "build",
      agentPresetId: agent.id,
      provider: "codex",
      role: "implementation",
      label: "Implementation agent",
      config: { model: "gpt-5" },
    });
    expect(attachment).toMatchObject({
      projectId: project.id,
      workflowId: workflow.id,
      nodeId: "build",
      agentPresetId: agent.id,
      provider: "codex",
      role: "implementation",
      config: { model: "gpt-5" },
    });
    expect(workflowRepository.listAgentAttachments(project.id, workflow.id)).toEqual([attachment]);

    const run = workflowRepository.createRun(project.id, workflow.id, {
      status: "running",
      trigger: "manual",
      input: { requestedBy: "test" },
      startedAt: "2026-07-07T00:00:00.000Z",
    });
    const completedRun = workflowRepository.updateRun(project.id, run.id, {
      status: "completed",
      output: { result: "ok" },
      finishedAt: "2026-07-07T00:01:00.000Z",
    });
    expect(completedRun).toMatchObject({
      status: "completed",
      input: { requestedBy: "test" },
      output: { result: "ok" },
    });
    expect(workflowRepository.listRuns(project.id, workflow.id).map((item) => item.id)).toEqual([run.id]);

    const step = workflowRepository.createStepRun(project.id, run.id, {
      nodeId: "build",
      status: "running",
      attempt: 2,
      agentAttachmentId: attachment.id,
      agentPresetId: agent.id,
      provider: "codex",
      input: { command: "pnpm run build" },
      startedAt: "2026-07-07T00:00:10.000Z",
    });
    const completedStep = workflowRepository.updateStepRun(project.id, step.id, {
      status: "completed",
      output: { exitCode: 0 },
      finishedAt: "2026-07-07T00:00:50.000Z",
    });
    expect(completedStep).toMatchObject({
      nodeId: "build",
      attempt: 2,
      agentAttachmentId: attachment.id,
      agentPresetId: agent.id,
      provider: "codex",
      input: { command: "pnpm run build" },
      output: { exitCode: 0 },
    });
    expect(workflowRepository.listStepRuns(project.id, run.id).map((item) => item.id)).toEqual([step.id]);

    expect(workflowRepository.deleteWorkflow(project.id, workflow.id)).toBe(true);
    const counts = storage.getDatabase().prepare(`
      SELECT
        (SELECT COUNT(*) FROM node_workflow_agent_attachments WHERE workflow_id = ?) AS attachments,
        (SELECT COUNT(*) FROM node_workflow_runs WHERE workflow_id = ?) AS runs,
        (SELECT COUNT(*) FROM node_workflow_run_steps WHERE workflow_id = ?) AS steps
    `).get(workflow.id, workflow.id, workflow.id) as { attachments: number; runs: number; steps: number };
    expect(counts).toEqual({ attachments: 0, runs: 0, steps: 0 });
  });

  it("rejects duplicate node ids", async () => {
    const { dir, projectRepository, workflowRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "Duplicate Nodes", sourceType: "local", sourceRef: dir });

    expect(() => workflowRepository.createWorkflow(project.id, workflowInput({
      nodes: [
        { id: "same", type: "specialist", title: "First", widgetDefinitions: [], widgetValues: {} },
        { id: "same", type: "specialist", title: "Second", widgetDefinitions: [], widgetValues: {} },
      ],
      edges: [],
    }))).toThrow(ValidationError);
  });

  it("rejects edges that reference missing endpoints", async () => {
    const { dir, projectRepository, workflowRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "Missing Edge", sourceType: "local", sourceRef: dir });

    expect(() => workflowRepository.createWorkflow(project.id, workflowInput({
      edges: [{ id: "missing", sourceNodeId: "plan", targetNodeId: "unknown" }],
    }))).toThrow(/unknown target node/);
  });

  it("rejects cyclic graphs", async () => {
    const { dir, projectRepository, workflowRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "Cyclic Workflow", sourceType: "local", sourceRef: dir });

    expect(() => workflowRepository.createWorkflow(project.id, workflowInput({
      edges: [
        { id: "plan-to-build", sourceNodeId: "plan", targetNodeId: "build" },
        { id: "build-to-plan", sourceNodeId: "build", targetNodeId: "plan" },
      ],
    }))).toThrow(/acyclic/);
  });

  it("rejects widget values that do not match widget definitions", async () => {
    const { dir, projectRepository, workflowRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "Invalid Widgets", sourceType: "local", sourceRef: dir });

    expect(() => workflowRepository.createWorkflow(project.id, workflowInput({
      widgetValues: { ...allWidgetValues(), limit: "five" },
    }))).toThrow(/finite number/);

    expect(() => workflowRepository.createWorkflow(project.id, workflowInput({
      nodes: [{
        id: "bad",
        type: "specialist",
        title: "Bad",
        widgetDefinitions: [{ key: "choice", type: "select", label: "Choice", options: [{ label: "A", value: "a" }] }],
        widgetValues: { choice: "b" },
      }],
      edges: [],
    }))).toThrow(/unsupported option value/);
  });

  it("fails closed on corrupt persisted workflow payloads without breaking unrelated project reads", async () => {
    const { dir, storage, projectRepository, workflowRepository } = await createRepositories();
    const corruptProject = projectRepository.createProject({ name: "Corrupt Payload", sourceType: "local", sourceRef: dir });
    const healthyProject = projectRepository.createProject({ name: "Healthy Payload", sourceType: "local", sourceRef: path.join(dir, "healthy") });
    const healthyWorkflow = workflowRepository.createWorkflow(healthyProject.id, workflowInput({ name: "Healthy workflow" }));
    const now = new Date().toISOString();

    storage.getDatabase().prepare(`
      INSERT INTO node_workflows (
        id, project_id, name, description, status, version, widget_definitions_json,
        widget_values_json, nodes_json, edges_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "corrupt-workflow",
      corruptProject.id,
      "Corrupt workflow",
      "",
      "draft",
      1,
      "[]",
      "{}",
      "{not-json",
      "[]",
      null,
      now,
      now,
    );

    expect(workflowRepository.listWorkflows(healthyProject.id).map((workflow) => workflow.id)).toEqual([healthyWorkflow.id]);
    expect(() => workflowRepository.listWorkflows(corruptProject.id)).toThrow(RepositoryError);
  });
});
