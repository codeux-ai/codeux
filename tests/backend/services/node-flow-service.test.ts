import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { NodeFlowService } from "../../../src/services/node-flow-service.js";
import type { NodeFlowGraph } from "../../../src/contracts/node-flow-types.js";
import type { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { registerCustomNodeDefinition, resolveNodeDefinition } from "../../../src/domain/node-flows/node-definition-registry.js";

const tempDirs: string[] = [];

async function createService(credentialBroker?: Partial<CredentialBroker>): Promise<{
  dir: string;
  projectRepository: ProjectManagementRepository;
  service: NodeFlowService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-flow-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    projectRepository: new ProjectManagementRepository(storage),
    service: new NodeFlowService(new NodeFlowRepository(storage), undefined, credentialBroker as CredentialBroker | undefined),
  };
}

const validGraph = (): NodeFlowGraph => ({
  nodes: [
    { id: "input", type: "input", title: "Input" },
    { id: "agent", type: "output", title: "Output" },
  ],
  edges: [{ fromNodeId: "input", toNodeId: "agent" }],
});

const REQUIRED_NODE_TYPE = "custom.required-credential-policy-fixture";

function registerRequiredCredentialDefinition(): void {
  if (resolveNodeDefinition(REQUIRED_NODE_TYPE, 1)) return;
  registerCustomNodeDefinition({
    type: REQUIRED_NODE_TYPE,
    version: 1,
    executable: true,
    executionKind: "custom",
    configurationSchema: { type: "object" },
    ui: { label: "Required credential", description: "", category: "custom", widgetSchema: { fields: [] } },
    ports: [],
    credentials: [{
      slot: "jobs",
      label: "Jobs API",
      required: true,
      allowedKinds: ["http.token"],
      requiredCapabilities: ["jobs.list"],
    }],
    capabilities: ["credentials.read"],
    sideEffect: "read",
    defaultPolicy: {},
    documentation: "docs/architecture/custom-nodes.md",
    deprecation: { deprecated: false },
  });
}

function compatibleAssessment(credentialId: string) {
  return {
    credentialId,
    projectId: "project",
    compatible: true,
    backendReady: true,
    configured: true,
    active: true,
    projectAccess: true,
    kindAllowed: true,
    capabilitiesAllowed: true,
    missingCapabilities: [],
    issues: [],
    metadata: null,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("NodeFlowService", () => {
  it("returns a full manifest for definition details and flat summaries for the catalog", async () => {
    const { service } = await createService();

    expect(service.catalog().nodes.find((node) => node.type === "input")).toMatchObject({
      type: "input",
      label: "Input",
      category: "control",
    });
    expect(service.nodeDefinition("input", 1)).toMatchObject({
      type: "input",
      version: 1,
      ui: {
        label: "Input",
        category: "control",
        widgetSchema: { fields: [] },
      },
      configurationSchema: { type: "object" },
      documentation: expect.any(String),
      deprecation: { deprecated: false },
    });
  });

  it("normalizes create/update input before persistence", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const created = await service.create(project.id, {
      title: "  Intake flow  ",
      description: "  Collects details  ",
      graph: validGraph(),
    });
    const updated = await service.update(created.id, {
      title: "  Intake flow updated  ",
      description: "  Updated description  ",
    });

    expect(created.title).toBe("Intake flow");
    expect(updated.title).toBe("Intake flow updated");
    expect(updated.description).toBe("Updated description");
  });

  it("rejects cyclic graphs before persistence", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const graph = validGraph();
    graph.edges.push({ fromNodeId: "agent", toNodeId: "input" });

    await expect(service.create(project.id, {
      title: "Bad flow",
      graph,
    })).rejects.toThrow(/acyclic|validation failed/i);
    expect(service.list(project.id).flows).toEqual([]);
  });

  it("returns structured validation failures without throwing", async () => {
    const { service } = await createService();
    const graph = validGraph();
    graph.edges.push({ fromNodeId: "missing", toNodeId: "agent" });

    const result = service.validate(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_edge_endpoint" }),
    ]));
  });

  it("applies optimistic draft patches without overwriting conflicting edits", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({ name: "Draft Project", sourceType: "local", sourceRef: dir });
    const draft = await service.createDraft(project.id, { title: "Draft", graph: validGraph() });

    const updated = await service.patchDraft(draft.flowId, {
      projectId: project.id,
      draftRevision: draft.draftRevision,
      operations: [{ op: "set_metadata", metadata: { purpose: "review" } }],
    });
    const conflict = await service.patchDraft(draft.flowId, {
      projectId: project.id,
      draftRevision: draft.draftRevision,
      operations: [{ op: "set_metadata", metadata: { purpose: "overwrite" } }],
    });

    expect(updated.draft?.draftRevision).toBe(2);
    expect(conflict.conflict).toMatchObject({ code: "draft_revision_conflict", expectedDraftRevision: 1, actualDraftRevision: 2 });
    expect(service.get(draft.flowId)?.graph.metadata).toEqual({ purpose: "review" });
  });

  it("publishes reviewed drafts and creates rollback drafts without replacing history", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({ name: "Publish Project", sourceType: "local", sourceRef: dir });
    const draft = await service.createDraft(project.id, { title: "Draft", graph: validGraph() });
    expect(draft.publishedVersion).toBeNull();
    const published = await service.publishDraft(project.id, draft.flowId, 1, "reviewer");
    expect(published.publishedVersion).toBe(1);
    const second = await service.patchDraft(draft.flowId, { projectId: project.id, draftRevision: 1, title: "Second" });
    const rollback = await service.rollback(project.id, draft.flowId, 1, second.draft!.draftRevision);
    expect(rollback.draftRevision).toBe(3);
    expect(rollback.name).toBe("Draft");
    expect(service.compareVersions(project.id, draft.flowId, 1, 3)).toMatchObject({ fromVersion: 1, toVersion: 3 });
  });

  it("keeps unbound optional slots reviewable and publishable", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({ name: "Optional Slot Project", sourceType: "local", sourceRef: dir });
    const draft = await service.createDraft(project.id, { title: "Optional slot", graph: {
      nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { prompt: "Hello" } }],
      edges: [],
    } });

    expect(draft.requiredCredentials).toEqual([expect.objectContaining({
      nodeId: "prompt",
      slot: "provider",
      required: false,
      status: "missing",
      requiredCapabilities: ["read"],
    })]);
    expect(draft.valid).toBe(true);
    await expect(service.publishDraft(project.id, draft.flowId, draft.draftRevision, "reviewer"))
      .resolves.toMatchObject({ publishedVersion: 1 });
  });

  it("keeps required bindings canonical in the graph and marks the request endpoint non-persistent", async () => {
    registerRequiredCredentialDefinition();
    const assessCompatibility = vi.fn(async (credentialId: string) => credentialId === "credential-good"
      ? compatibleAssessment(credentialId)
      : { ...compatibleAssessment(credentialId), compatible: false, active: false, issues: ["not_active" as const] });
    const { dir, projectRepository, service } = await createService({ assessCompatibility });
    const project = projectRepository.createProject({ name: "Required Slot Project", sourceType: "local", sourceRef: dir });
    const draft = await service.createDraft(project.id, { title: "Required slot", graph: {
      nodes: [{ id: "custom", type: REQUIRED_NODE_TYPE, title: "Custom" }],
      edges: [],
    } });

    expect(draft.valid).toBe(false);
    expect(draft.policyFindings).toContainEqual(expect.objectContaining({ code: "missing_credential_binding" }));
    await expect(service.publishDraft(project.id, draft.flowId, draft.draftRevision, "reviewer")).rejects.toThrow(/valid draft/i);
    await expect(service.requestCredential(project.id, draft.flowId, "custom", "jobs")).resolves.toMatchObject({
      requestStatus: "requested",
      persistence: "none",
      bindingChanged: false,
      credentialId: null,
    });
    expect(service.get(draft.flowId)?.graph.nodes[0]?.credentialBindings).toEqual([]);

    const denied = await service.patchDraft(draft.flowId, {
      projectId: project.id,
      draftRevision: draft.draftRevision,
      operations: [{ op: "upsert_node", node: {
        id: "custom", type: REQUIRED_NODE_TYPE, title: "Custom",
        credentialBindings: [{ slot: "jobs", credentialId: "credential-revoked" }],
      } }],
    });
    expect(denied.draft?.requiredCredentials[0]).toMatchObject({ status: "denied", active: false, compatibilityIssues: ["not_active"] });

    const replacement = await service.patchDraft(draft.flowId, {
      projectId: project.id,
      draftRevision: denied.draft!.draftRevision,
      operations: [{ op: "upsert_node", node: {
        id: "custom", type: REQUIRED_NODE_TYPE, title: "Custom",
        credentialBindings: [{ slot: "jobs", credentialId: "credential-good" }],
      } }],
    });
    expect(replacement.draft?.requiredCredentials[0]).toMatchObject({ credentialId: "credential-good", status: "bound" });
    expect(service.get(draft.flowId)?.graph.nodes[0]?.credentialBindings).toEqual([{ slot: "jobs", credentialId: "credential-good" }]);
    await expect(service.publishDraft(project.id, draft.flowId, replacement.draft!.draftRevision, "reviewer")).resolves.toBeDefined();
    expect(assessCompatibility).toHaveBeenLastCalledWith("credential-good", {
      projectId: project.id,
      allowedKinds: ["http.token"],
      requiredCapabilities: ["jobs.list"],
    });
  });

  it.each([
    ["backend_unavailable", "credential_backend_unavailable", { backendReady: false }],
    ["not_configured", "credential_not_configured", { configured: false }],
    ["not_active", "credential_not_active", { active: false }],
    ["project_access_denied", "credential_project_access_denied", { projectAccess: false }],
    ["kind_not_allowed", "credential_kind_not_allowed", { kindAllowed: false }],
    ["capability_missing", "credential_capability_missing", { capabilitiesAllowed: false, missingCapabilities: ["jobs.list"] }],
  ] as const)("blocks publication with a stable %s compatibility finding", async (issue, findingCode, state) => {
    registerRequiredCredentialDefinition();
    const assessCompatibility = vi.fn(async (credentialId: string) => ({
      ...compatibleAssessment(credentialId),
      ...state,
      compatible: false,
      issues: [issue],
    }));
    const { dir, projectRepository, service } = await createService({ assessCompatibility });
    const project = projectRepository.createProject({ name: "Denied Slot Project", sourceType: "local", sourceRef: dir });
    const draft = await service.createDraft(project.id, { title: "Denied slot", graph: {
      nodes: [{
        id: "custom", type: REQUIRED_NODE_TYPE, title: "Custom",
        credentialBindings: [{ slot: "jobs", credentialId: "credential-denied" }],
      }],
      edges: [],
    } });

    expect(draft.valid).toBe(false);
    expect(draft.policyFindings).toContainEqual(expect.objectContaining({ code: findingCode, nodeId: "custom" }));
    await expect(service.publishDraft(project.id, draft.flowId, draft.draftRevision, "reviewer")).rejects.toThrow(/valid draft/i);
  });

  it("applies the same compatibility gate to the legacy direct publication path", async () => {
    registerRequiredCredentialDefinition();
    const assessCompatibility = vi.fn(async (credentialId: string) => ({
      ...compatibleAssessment(credentialId),
      compatible: false,
      active: false,
      issues: ["not_active" as const],
    }));
    const { dir, projectRepository, service } = await createService({ assessCompatibility });
    const project = projectRepository.createProject({ name: "Legacy Publication Project", sourceType: "local", sourceRef: dir });

    await expect(service.create(project.id, { title: "Legacy publication", graph: {
      nodes: [{
        id: "custom", type: REQUIRED_NODE_TYPE, title: "Custom",
        credentialBindings: [{ slot: "jobs", credentialId: "credential-revoked" }],
      }],
      edges: [],
    } })).rejects.toThrow(/credential policy must pass review/i);
    expect(service.list(project.id).flows).toEqual([]);
  });
});
