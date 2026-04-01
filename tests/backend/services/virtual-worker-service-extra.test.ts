import { describe, expect, it, vi } from "vitest";
import { VirtualWorkerService } from "../../../src/services/virtual-worker-service.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "virtual-worker-extra-"));
  const appStorage = new AppDbStorage(path.join(dir, "app.db"));
  const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
  const sessionTracking = new SessionTrackingRepository(path.join(dir, "session-tracking.db"));
  const projectManagementRepository = new ProjectManagementRepository(appStorage);
  const executionRepository = new ExecutionRepository(appStorage);
  const workerEndpointRepository = new WorkerEndpointRepository(appStorage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(appStorage);
  const projectAttentionRepository = new ProjectAttentionRepository(appStorage);
  
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository, 
    projectWorkerAssignmentRepository,
    (pid) => {
        const s = settingsRepository.getProjectSettings(pid);
        return s?.workers?.executionMode || "CONNECTED_MCP";
    }
  );

  const deps = {
    settingsRepository,
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectWorkerAssignmentService: new ProjectWorkerAssignmentService(projectWorkerAssignmentRepository, workerEndpointRepository),
    projectAttentionService,
    workerTaskDispatchService: {
        claimNextTaskDispatch: vi.fn(),
    } as any,
    cliWorkflowService: {} as any,
    sprintExecutionStateService: {
        getSprintStatus: vi.fn().mockReturnValue("idle"),
    } as any,
    workerInboxReplyService: {} as any,
    instructionService: {} as any,
    approveSessionPlan: vi.fn(),
    sendSessionMessage: vi.fn(),
  };

  const service = new VirtualWorkerService(deps);

  return { dir, deps, service };
}

describe("VirtualWorkerService Extra Coverage", () => {
  it("readRequiredString throws on various invalid values", async () => {
    const { service } = await createFixture();
    const readRequiredString = (service as any).readRequiredString.bind(service);
    
    expect(() => readRequiredString(null, "test")).toThrow("Missing test");
    expect(() => readRequiredString(undefined, "test")).toThrow("Missing test");
    expect(() => readRequiredString("", "test")).toThrow("Missing test");
    expect(() => readRequiredString("   ", "test")).toThrow("Missing test");
    expect(readRequiredString("valid", "test")).toBe("valid");
  });

  it("asRecord handles non-record values", async () => {
    const { service } = await createFixture();
    const asRecord = (service as any).asRecord.bind(service);
    
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord([])).toBeNull();
    expect(asRecord("string")).toBeNull();
    expect(asRecord(123)).toBeNull();
    expect(asRecord({})).toEqual({});
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("extractCurrentTaskPrompt handles various payload structures", async () => {
    const { service } = await createFixture();
    const extract = (service as any).extractCurrentTaskPrompt.bind(service);
    
    expect(extract({})).toBe("");
    expect(extract({ currentTaskPrompt: "Direct prompt" })).toBe("Direct prompt");
    expect(extract({ currentTask: { taskPrompt: "Nested prompt" } })).toBe("Nested prompt");
    expect(extract({ taskPrompt: "Legacy prompt" })).toBe("Legacy prompt");
    expect(extract({ currentTaskPrompt: "  Direct  ", taskPrompt: "Legacy" })).toBe("Direct");
  });

  it("extractMergeConflictTaskPrompts handles various entry structures", async () => {
    const { service } = await createFixture();
    const extract = (service as any).extractMergeConflictTaskPrompts.bind(service);
    
    expect(extract([])).toEqual([]);
    expect(extract([null, undefined, 123])).toEqual([]);
    expect(extract([{ taskKey: "T1", taskTitle: "Title", taskPrompt: "Prompt" }])).toEqual(["T1 Title\n\nPrompt"]);
    expect(extract([{ title: "Title Only", prompt: "Prompt Only" }])).toEqual(["task Title Only\n\nPrompt Only"]);
    expect(extract([{ taskKey: "T2" }])).toEqual(["T2 T2"]);
  });

  it("getProviderLabel returns default for unknown", async () => {
    const { service } = await createFixture();
    const getLabel = (service as any).getProviderLabel.bind(service);
    
    expect(getLabel("claude-code")).toBe("Claude Code");
    expect(getLabel("gemini")).toBe("Gemini");
    expect(getLabel("codex")).toBe("Codex");
    expect(getLabel("unknown" as any)).toBe("Codex");
  });
  
  it("cleanupOrphanedVirtualWorkers cleans up active assignments", async () => {
    const { deps, service } = await createFixture();
    
    const endpoint = deps.workerEndpointRepository.createVirtualEndpoint({
        endpointKey: "virtual:orphaned",
        displayName: "Orphaned",
        status: "connected",
        transport: "internal",
        capabilities: {},
    });
    
    const project = deps.projectManagementRepository.createProject({
        name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    
    deps.projectWorkerAssignmentService.ensureWorkerAssignment(project.id, endpoint.id);
    
    expect(deps.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(endpoint.id)).toHaveLength(1);
    
    (service as any).cleanupOrphanedVirtualWorkers();
    
    expect(deps.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(endpoint.id)).toHaveLength(0);
    expect(deps.workerEndpointRepository.getWorkerEndpoint(endpoint.id)).toBeFalsy();
  });

  it("projectUsesVirtualWorkers checks settings", async () => {
    const { deps, service } = await createFixture();
    const project = deps.projectManagementRepository.createProject({ name: "P", sourceType: "local", sourceRef: "/t" });
    
    expect((service as any).projectUsesVirtualWorkers(project.id)).toBe(false);
    
    deps.settingsRepository.saveProjectSettings(project.id, { workers: { executionMode: "VIRTUAL" } });
    expect((service as any).projectUsesVirtualWorkers(project.id)).toBe(true);
  });

  it("resolveWorkerExecutionMode returns mode from settings", async () => {
    const { deps, service } = await createFixture();
    const project = deps.projectManagementRepository.createProject({ name: "P", sourceType: "local", sourceRef: "/t" });
    
    expect((service as any).resolveWorkerExecutionMode(project.id)).toBe("CONNECTED_MCP");
    
    deps.settingsRepository.saveProjectSettings(project.id, { workers: { executionMode: "VIRTUAL" } });
    expect((service as any).resolveWorkerExecutionMode(project.id)).toBe("VIRTUAL");
  });

  it("projectNeedsVirtualWorker checks assignment and status", async () => {
    const { deps, service } = await createFixture();
    const project = deps.projectManagementRepository.createProject({ name: "P", sourceType: "local", sourceRef: "/t" });
    
    expect((service as any).projectNeedsVirtualWorker(project.id)).toBe(false);
    
    deps.settingsRepository.saveProjectSettings(project.id, { workers: { executionMode: "VIRTUAL" } });
    
    // Create pickable attention to make it true
    deps.projectAttentionService.openItem({
        projectId: project.id,
        attentionType: "action_required",
        severity: "medium",
        title: "T",
        summaryMarkdown: "S",
        ownerType: "worker",
    });
    
    expect((service as any).projectNeedsVirtualWorker(project.id)).toBe(true);
    
    // Test with active cycle
    (service as any).activeCycles.set(project.id, Promise.resolve());
    expect((service as any).projectNeedsVirtualWorker(project.id)).toBe(false);
  });

  it("pickNextWorkerAttention picks from repo", async () => {
    const { deps, service } = await createFixture();
    const project = deps.projectManagementRepository.createProject({ name: "P", sourceType: "local", sourceRef: "/t" });
    
    expect((service as any).pickNextWorkerAttention(project.id)).toBeNull();
    
    deps.projectAttentionService.openItem({
        projectId: project.id,
        attentionType: "action_required",
        severity: "medium",
        title: "T",
        summaryMarkdown: "S",
        ownerType: "worker",
    });
    
    const item = (service as any).pickNextWorkerAttention(project.id);
    expect(item).toBeDefined();
    expect(item.title).toBe("T");
  });

  it("buildDispatchSummary handles empty session", async () => {
    const { service } = await createFixture();
    const claim = { 
        project: { name: "Proj" },
        sprint: { name: "Sprint" },
        task: { taskKey: "T1", title: "Title" }
    } as any;
    const session = { state: "RUNNING" } as any;
    
    const summary = (service as any).buildDispatchSummary(claim, session);
    expect(summary).toContain("T1 Title");
    expect(summary).toContain("RUNNING");
  });
});
