import { describe, expect, it } from "vitest";
import type { CustomNodeArtifact, CustomNodeManifest, CustomNodeValidationReport } from "../../../src/contracts/custom-node-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

const manifest = (id = "safe-node"): CustomNodeManifest => ({
  schemaVersion: 1, id, nodeType: `custom.${id}`, version: 1, name: "Safe node", description: "",
  entrypoint: "dist/index.js", inputSchema: { type: "object" }, outputSchema: { type: "object" },
  configurationSchema: { type: "object" }, capabilities: ["clock.read"], credentials: [],
  resources: { cpu: 0.5, memoryMb: 128, pids: 64, timeoutMs: 30_000, maxOutputBytes: 262_144, scratchMb: 32 },
});

describe("CustomNodeRepository", () => {
  it("enforces draft, validation, immutable artifact, and publication lifecycle", () => {
    const storage = new AppDbStorage(":memory:");
    const project = new ProjectManagementRepository(storage).createProject({ name: "Custom Node Test", sourceType: "local", sourceRef: "/tmp/custom-node-test" });
    const repository = new CustomNodeRepository(storage);
    const nodeManifest = manifest();
    const draft = repository.createDraft(project.id, { manifest: nodeManifest, sourceRevision: "revision-1", createdBy: "test" });
    expect(draft.status).toBe("draft");
    repository.beginValidation(draft.id);
    const report: CustomNodeValidationReport = { valid: true, checks: [{ name: "all", passed: true, durationMs: 1 }], issues: [], validatedAt: new Date().toISOString() };
    const artifact: CustomNodeArtifact = {
      digest: `sha256:${"a".repeat(64)}`, nodeId: draft.id, projectId: project.id, version: 1,
      sourceRevision: "revision-1", buildDigest: `sha256:${"b".repeat(64)}`,
      runtimeImageDigest: `sha256:${"c".repeat(64)}`, dependencies: [], validationReport: report,
      createdBy: "test", invocationId: "invocation", correlationId: "correlation",
      capabilities: ["clock.read"], manifest: nodeManifest, createdAt: new Date().toISOString(),
    };
    expect(repository.completeValidation(draft.id, report, artifact).status).toBe("passed");
    const publication = repository.publish(draft.id, "publisher");
    expect(publication).toMatchObject({ nodeType: "custom.safe-node", version: 1, artifactDigest: artifact.digest });
    expect(repository.resolvePublished("custom.safe-node", 1)?.artifact).toEqual(artifact);
    expect(repository.getNode(draft.id)?.status).toBe("published");
    expect(() => repository.beginValidation(draft.id)).toThrow(/immutable/i);
    storage.close();
  });

  it("rejects publication after failed validation", () => {
    const storage = new AppDbStorage(":memory:");
    const project = new ProjectManagementRepository(storage).createProject({ name: "Failed Node Test", sourceType: "local", sourceRef: "/tmp/failed-node-test" });
    const repository = new CustomNodeRepository(storage);
    repository.createDraft(project.id, { manifest: manifest("failed-node"), sourceRevision: "revision-1", createdBy: "test" });
    repository.beginValidation("failed-node");
    repository.completeValidation("failed-node", { valid: false, checks: [], issues: [{ check: "scan", code: "failed", message: "failed" }], validatedAt: new Date().toISOString() }, null);
    expect(() => repository.publish("failed-node", "publisher")).toThrow(/passed/i);
    storage.close();
  });
});
