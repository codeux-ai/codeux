import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import { HeadlessAuthService } from "../../../src/services/headless-auth-service.js";
import { HeadlessOperationalReadinessService } from "../../../src/services/headless-operational-readiness-service.js";
import { DistributedNodeFlowRunnerService } from "../../../src/services/distributed-node-flow-runner-service.js";
import type { CodeUxPrincipal, HeadlessSecurityConfiguration } from "../../../src/contracts/headless-security-types.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";
import { selectCredentialKeyProvider } from "../../../src/services/credentials/key-provider-selection.js";

const temporaryDirectories: string[] = [];

async function storageFixture(): Promise<{ directory: string; storage: AppDbStorage }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-headless-"));
  temporaryDirectories.push(directory);
  return { directory, storage: new AppDbStorage(path.join(directory, "app.db")) };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function request(pathname: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return { path: pathname, method, headers, secure: headers["x-forwarded-proto"] === "https", body: {} } as unknown as Request;
}

const runnerPrincipal: CodeUxPrincipal = {
  id: "runner-one",
  displayName: "Runner one",
  kind: "service",
  roles: ["automation_runner"],
  projectIds: [],
  authenticatedAt: new Date().toISOString(),
  authenticationMethod: "service_token",
};

describe("authenticated headless automation operations", () => {
  it("authenticates service identities and enforces roles, projects, TLS, and the credential feature gate", () => {
    const token = "fixture-service-token";
    const configuration: HeadlessSecurityConfiguration = {
      mode: "service_token",
      serviceIdentities: [{
        id: "runner-one",
        displayName: "Runner one",
        tokenSha256: createHash("sha256").update(token).digest("hex"),
        roles: ["automation_runner", "viewer"],
        projectIds: ["project-allowed"],
        enabled: true,
      }],
      allowInsecureHttp: false,
      remoteCredentialManagement: false,
    };
    const service = new HeadlessAuthService(configuration);
    const headers = { authorization: `Bearer ${token}`, "x-forwarded-proto": "https", "x-code-ux-service-id": "runner-one" };
    const principal = service.authenticate(request("/projects/project-allowed/node-flows/flow/run", headers, "POST"));
    expect(() => service.authorize(request("/projects/project-allowed/node-flows/flow/run", headers, "POST"), principal)).not.toThrow();
    expect(() => service.authorize(request("/projects/project-denied/node-flows/flow/run", headers, "POST"), principal)).toThrow(/not authorized/i);
    expect(() => service.authorize(request("/projects/project-allowed/credentials", headers), principal)).toThrow(/credential_admin/i);
    expect(() => service.authenticate(request("/projects/project-allowed/node-flows", { authorization: `Bearer ${token}` }))).toThrow(/TLS/i);
    expect(() => service.authenticate(request("/projects/project-allowed/node-flows", { ...headers, "x-code-ux-service-id": "other" }))).toThrow(/identity assertion/i);
  });

  it("persists redacted correlation audit records and exports restart-safe NDJSON", async () => {
    vi.stubEnv("VITEST_IN_MEMORY_DB", "false");
    const { directory, storage } = await storageFixture();
    const service = new AutomationAuditExportService(storage);
    service.recordSystem({
      action: "automation.build",
      resourceType: "custom_node",
      resourceId: "node-one",
      projectId: "project-one",
      outcome: "succeeded",
      metadata: { authorization: "Bearer must-not-leak", nested: { apiKey: "must-not-leak" } },
    });
    storage.close();

    const reopened = new AppDbStorage(path.join(directory, "app.db"));
    const exported = new AutomationAuditExportService(reopened).exportNdjson({ projectId: "project-one" });
    expect(exported).toContain("automation.build");
    expect(exported).not.toContain("must-not-leak");
    expect(exported).toContain("[REDACTED]");
    reopened.close();
  });

  it("fails key readiness closed only when encrypted data requires recovery", async () => {
    const health = vi.fn(async () => ({ available: false, secure: true, provider: "vault", keyId: null, keyVersion: null, reason: "vault unavailable" }));
    const unavailableKeyProvider: KeyProvider = {
      providerName: "vault",
      health,
      getActiveKey: async () => { throw new Error("unavailable"); },
      getKey: async () => { throw new Error("unavailable"); },
    };
    const auditService = { health: () => true } as unknown as AutomationAuditExportService;
    const optional = new HeadlessOperationalReadinessService({
      credentialRepository: { countEncryptedSecrets: () => 0 } as unknown as AutomationCredentialRepository,
      keyProvider: unavailableKeyProvider,
      auditService,
      security: { mode: "local", serviceIdentities: [], allowInsecureHttp: true, remoteCredentialManagement: false },
    });
    await expect(optional.refresh()).resolves.toMatchObject({ status: "READY", components: { credentialKey: { status: "not_required" } } });
    expect(health).not.toHaveBeenCalled();

    const required = new HeadlessOperationalReadinessService({
      credentialRepository: { countEncryptedSecrets: () => 1 } as unknown as AutomationCredentialRepository,
      keyProvider: unavailableKeyProvider,
      auditService,
      security: { mode: "local", serviceIdentities: [], allowInsecureHttp: true, remoteCredentialManagement: false },
    });
    await expect(required.assertStartupReady()).rejects.toThrow(/encrypted credential data exists/i);
    expect(health).toHaveBeenCalledTimes(1);
    expect(required.snapshot()).toMatchObject({ status: "NOT_READY", components: { credentialKey: { provider: "vault" } } });
  });

  it("refuses automatic local-file custody outside the trusted local dashboard mode", async () => {
    const { directory, storage } = await storageFixture();
    storage.close();
    const cases = [
      {
        name: "server mode",
        appConfig: { serverMode: true, dashboardEnabled: false },
        security: { mode: "service_token" as const, remoteCredentialManagement: false },
        environment: {},
      },
      {
        name: "dashboard-disabled headless mode",
        appConfig: { serverMode: false, dashboardEnabled: false },
        security: { mode: "local" as const, remoteCredentialManagement: false },
        environment: {},
      },
      {
        name: "authenticated dashboard mode",
        appConfig: { serverMode: false, dashboardEnabled: true },
        security: { mode: "trusted_proxy" as const, remoteCredentialManagement: false },
        environment: {},
      },
      {
        name: "remote credential management",
        appConfig: { serverMode: false, dashboardEnabled: true },
        security: { mode: "local" as const, remoteCredentialManagement: true },
        environment: {},
      },
      {
        name: "non-loopback dashboard binding",
        appConfig: { serverMode: false, dashboardEnabled: true },
        security: { mode: "local" as const, remoteCredentialManagement: false },
        environment: { DASHBOARD_HOST: "0.0.0.0" },
      },
    ];

    for (const fixture of cases) {
      const localFilePath = path.join(directory, fixture.name.replaceAll(" ", "-"), "credential-root.key");
      const provider = selectCredentialKeyProvider({
        appConfig: fixture.appConfig,
        security: fixture.security,
        environment: fixture.environment,
        processProvider: null,
        localFilePath,
      });
      expect(provider.providerName, fixture.name).toBe("mounted-key-file");
      await expect(provider.health()).resolves.toMatchObject({ available: false, secure: true });
      await expect(fs.stat(localFilePath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("grants a queued run to exactly one authorized project-scoped runner", async () => {
    const { directory, storage } = await storageFixture();
    const project = new ProjectManagementRepository(storage).createProject({ name: "Approved local test project", sourceType: "local", sourceRef: directory });
    const repository = new NodeFlowRepository(storage);
    const flow = repository.createFlow(project.id, { title: "Distributed", graph: { nodes: [{ id: "output", type: "output", title: "Output" }], edges: [] } });
    const publication = repository.getPublication(flow.id)!;
    const run = repository.createRun({ projectId: project.id, flowId: flow.id, version: publication.version, publicationId: publication.id, policy: publication.policy, status: "queued" });
    const principal = { ...runnerPrincipal, projectIds: [project.id] };
    const first = new DistributedNodeFlowRunnerService(repository).claimNext(principal);
    const second = new DistributedNodeFlowRunnerService(repository).claimNext(principal);
    expect(first).toMatchObject({ id: run.id, leaseOwner: principal.id, status: "running" });
    expect(second).toBeNull();
    expect(new DistributedNodeFlowRunnerService(repository).heartbeat(principal, run.id, 30_000)).toBe(true);
    expect(() => new DistributedNodeFlowRunnerService(repository).claimNext({ ...principal, kind: "user" })).toThrow(/service principal/i);
    storage.close();
  });
});
