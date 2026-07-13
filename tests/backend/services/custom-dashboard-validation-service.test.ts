import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";
import type {
  CustomDashboardFileBundle,
  CustomDashboardManifest,
} from "../../../src/contracts/custom-dashboard-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomDashboardRepository } from "../../../src/repositories/custom-dashboard-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { CustomDashboardValidationService } from "../../../src/services/custom-dashboard-validation-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

const tempDirs: string[] = [];

function commandResult(stdout = "", stderr = ""): CommandResult {
  return { ok: true, code: 0, stdout, stderr };
}

async function createFixture(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projects: ProjectManagementRepository;
  dashboards: CustomDashboardRepository;
  service: CustomDashboardValidationService;
  projectId: string;
  dashboardId: string;
  revisionId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-dashboard-validation-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Custom Dashboard Validation Project",
    sourceType: "local",
    sourceRef: dir,
  });
  const dashboards = new CustomDashboardRepository(storage);
  const dashboard = dashboards.createDraft(project.id, {
    title: "Delivery Pulse",
    manifest: manifest(),
    fileBundle: fileBundle(),
    sourceNodeGraph: {
      nodes: [{ id: "incidents", type: "external_api", title: "Incidents", config: { endpoint: "/incidents" } }],
      edges: [],
    },
    runtimeMetadata: { integrations: { incidents: { readonly: true } } },
  });
  const revision = dashboards.createRevision(dashboard.id);
  const service = new CustomDashboardValidationService({
    customDashboardRepository: dashboards,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    fetchImpl: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    readinessTimeoutMs: 50,
    readinessPollMs: 1,
    managedRuntimeService: {
      resolveImage: vi.fn(async () => "node:24-bookworm"),
    } as any,
  });

  return {
    dir,
    storage,
    projects,
    dashboards,
    service,
    projectId: project.id,
    dashboardId: dashboard.id,
    revisionId: revision.id,
  };
}

function manifest(): CustomDashboardManifest {
  return {
    schemaVersion: 1,
    title: "Delivery Pulse",
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx", "src/data.ts", "src/styles.css"],
  };
}

function fileBundle(content = "export default function Dashboard() { return <div>ok</div>; }"): CustomDashboardFileBundle {
  return {
    files: [
      { path: "src/dashboard.tsx", content },
      { path: "src/data.ts", content: "export const rows = [];" },
      { path: "src/styles.css", content: '@import "tailwindcss";\n@theme { --color-jade-500: #00a86b; }' },
    ],
  };
}

function mockSuccessfulDocker(): void {
  vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
    if (command !== "docker") {
      return commandResult();
    }
    const action = args[0];
    if (action === "run") {
      await writeFakeViewerDist(args);
      return commandResult("install ok\nbuild ok\n");
    }
    if (action === "create") {
      return commandResult("container-123\n");
    }
    if (action === "start" || action === "rm") {
      return commandResult();
    }
    if (action === "logs") {
      return commandResult("vite preview ready\n");
    }
    if (action === "ps") {
      return commandResult("container-123\tcode-ux-cdash-test\tUp 2 seconds\tproject\tdashboard\trevision\t\t4445\n");
    }
    return commandResult();
  });
}

async function writeFakeViewerDist(args: string[]): Promise<void> {
  const workspaceMount = args.find((arg) => arg.includes("target=/code-ux-custom-dashboard/workspace"));
  const source = workspaceMount
    ?.split(",")
    .find((part) => part.startsWith("source="))
    ?.slice("source=".length);
  if (!source) {
    return;
  }
  const assetsDir = path.join(source, "dist", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(
    path.join(source, "dist", "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head><link rel=\"stylesheet\" href=\"/assets/index.css\"></head>",
      "<body><div id=\"app\"></div><script type=\"module\" src=\"/assets/index.js\"></script></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(assetsDir, "index.css"), ".grid{display:grid}.text-jade-500{color:#00a86b}", "utf8");
  await fs.writeFile(path.join(assetsDir, "index.js"), "document.body.textContent = 'Custom dashboard revision';", "utf8");
}

beforeEach(() => {
  vi.mocked(runCommandStrict).mockReset();
  mockSuccessfulDocker();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CustomDashboardValidationService", () => {
  it("materializes a revision, builds it in Docker, starts a detached session, and marks validation passed", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId, dir } = await createFixture();

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("passed");
    expect(session.validationReport).toMatchObject({
      valid: true,
      issues: [],
      metadata: { containerId: "container-123" },
    });
    const revision = dashboards.getRevisionById(revisionId);
    expect(revision?.validationStatus).toBe("passed");
    expect(revision?.validationReport?.valid).toBe(true);
    expect(revision?.runtimeMetadata).toMatchObject({
      integrations: { incidents: { readonly: true } },
      validation: {
        viewerArtifact: {
          kind: "vite-dist",
          entryFile: "index.html",
          files: expect.arrayContaining([
            expect.objectContaining({ path: "index.html", contentType: "text/html" }),
            expect.objectContaining({ path: "assets/index.js", content: expect.stringContaining("Custom dashboard revision") }),
          ]),
        },
      },
    });
    expect(dashboards.getDashboardById(dashboardId)?.status).toBe("validated");

    const workspacePath = path.join(dir, ".code-ux", "runtime", "custom-dashboards", dashboardId, revisionId, "workspace");
    await expect(fs.readFile(path.join(workspacePath, "src", "dashboard.tsx"), "utf8")).resolves.toContain("Dashboard");
    const bridge = await fs.readFile(path.join(workspacePath, ".codeux-harness", "codeux-data-bridge.ts"), "utf8");
    expect(bridge).toContain("externalApiNodes");
    expect(bridge).toContain("/api/custom-dashboard-runtime/source");
    expect(bridge).toContain(`\"sessionId\": \"${session.id}\"`);
    expect(bridge).not.toContain("credentialId");
    expect(bridge).not.toContain("route-secret");
    await expect(fs.readFile(path.join(workspacePath, "src", "styles.css"), "utf8")).resolves.toContain("tailwindcss");
    await expect(fs.readFile(path.join(workspacePath, "vite.config.ts"), "utf8")).resolves.toContain("tailwindcss()");
    const packageJson = JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.scripts).toEqual({ build: "tsc --noEmit && vite build", start: "vite preview --host 0.0.0.0" });
    expect(packageJson.dependencies).toMatchObject({ preact: "10.29.0", tailwindcss: "4.2.1", "@tailwindcss/vite": "4.2.1" });

    const dockerCalls = vi.mocked(runCommandStrict).mock.calls.filter(([command]) => command === "docker");
    expect(dockerCalls.some(([, args]) => args[0] === "run" && args.includes("npm install --ignore-scripts --no-audit --no-fund --package-lock=false && npm run build --ignore-scripts"))).toBe(true);
    expect(dockerCalls.some(([, args]) => args[0] === "create" && args.includes("--name"))).toBe(true);
    expect(dockerCalls.some(([, args]) => args[0] === "start")).toBe(true);
    expect(dockerCalls.flatMap(([, args]) => args).filter((arg) => arg.startsWith("type=")).join(" ")).not.toContain("/opt/credentials");
  });

  it.each([
    {
      label: "HTML",
      entryFile: "index.html",
      contentType: "text/html",
      content: "<!doctype html><html><head><title>Legacy</title></head><body><main>Legacy HTML revision</main></body></html>",
      expectedIndex: "Legacy HTML revision",
    },
    {
      label: "browser JavaScript",
      entryFile: "dashboard.js",
      contentType: "text/javascript",
      content: "document.querySelector('#codeux-custom-dashboard-root').textContent = 'Legacy JavaScript revision';",
      expectedIndex: "dashboard.js",
    },
  ])("validates and publishes a legacy $label revision through the isolated source viewer", async ({ entryFile, contentType, content, expectedIndex }) => {
    const { dashboards, service, projectId, dashboardId, dir } = await createFixture();
    const revision = dashboards.createRevision(dashboardId, {
      manifest: { ...manifest(), entryFile, filePaths: [entryFile] },
      fileBundle: { files: [{ path: entryFile, content, contentType }] },
      routes: [],
    });

    const session = await service.startValidation(projectId, dashboardId, revision.id);
    const published = dashboards.publishRevision(dashboardId, revision.id, session.id);

    expect(session).toMatchObject({ status: "passed", validationReport: { valid: true } });
    const validatedRevision = dashboards.getRevisionById(revision.id);
    expect(validatedRevision?.validationStatus).toBe("passed");
    expect(validatedRevision?.runtimeMetadata.validation).not.toHaveProperty("viewerArtifact");
    expect(published).toMatchObject({ status: "published", publishedRevisionId: revision.id });
    const workspacePath = path.join(dir, ".code-ux", "runtime", "custom-dashboards", dashboardId, revision.id, "workspace");
    await expect(fs.readFile(path.join(workspacePath, "index.html"), "utf8")).resolves.toContain(expectedIndex);
    const packageJson = JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toEqual({ build: "vite build", start: "vite preview --host 0.0.0.0" });
  });

  it("records TypeScript build failures and keeps publication state unchanged", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "run") {
        throw new Error("src/dashboard.tsx(1,7): error TS2322: Type 'string' is not assignable to type 'number'.");
      }
      if (args[0] === "logs") {
        return commandResult("build failed\n");
      }
      return commandResult();
    });

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("failed");
    expect(session.validationReport).toMatchObject({
      valid: false,
      issues: [{ code: "validation_failed" }],
    });
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("failed");
    expect(dashboards.getDashboardById(dashboardId)?.publishedRevisionId).toBeNull();
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "create")).toBe(false);
  });

  it("rejects unsafe package configuration before Docker and leaves the revision inert", async () => {
    const { dashboards, service, projectId, dashboardId } = await createFixture();
    const revision = dashboards.createRevision(dashboardId, {
      manifest: { ...manifest(), filePaths: [...manifest().filePaths, "package.json"] },
      fileBundle: {
        files: [
          ...fileBundle().files,
          { path: "package.json", content: '{"scripts":{"postinstall":"curl https://example.invalid"}}' },
        ],
      },
    });

    const session = await service.startValidation(projectId, dashboardId, revision.id);

    expect(session.status).toBe("failed");
    expect(session.validationReport?.summary).toContain("Unsupported custom dashboard source or package configuration");
    expect(dashboards.getRevisionById(revision.id)?.runtimeMetadata.validation).toBeUndefined();
    expect(dashboards.getDashboardById(dashboardId)?.publishedRevisionId).toBeNull();
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "run")).toBe(false);
  });

  it("fails closed when the preview container cannot start", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "run") {
        await writeFakeViewerDist(args);
        return commandResult("build ok");
      }
      if (args[0] === "create") return commandResult("container-123\n");
      if (args[0] === "start") throw new Error("docker start failed");
      return commandResult();
    });

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("failed");
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("failed");
    expect(dashboards.getRevisionById(revisionId)?.runtimeMetadata.validation).toBeUndefined();
  });

  it("fails closed when readiness never succeeds", async () => {
    const fixture = await createFixture();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("not ready"));
    (fixture.service as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchImpl;

    const session = await fixture.service.startValidation(fixture.projectId, fixture.dashboardId, fixture.revisionId);

    expect(session.status).toBe("failed");
    expect(session.validationReport?.summary).toContain("did not become reachable");
    expect(fixture.dashboards.getDashboardById(fixture.dashboardId)?.publishedRevisionId).toBeNull();
  });

  it("rejects oversized viewer artifacts before start or publication", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "run") {
        await writeFakeViewerDist(args);
        const workspaceMount = args.find((arg) => arg.includes("target=/code-ux-custom-dashboard/workspace"));
        const source = workspaceMount?.split(",").find((part) => part.startsWith("source="))?.slice("source=".length);
        if (source) await fs.writeFile(path.join(source, "dist", "assets", "index.js"), "x".repeat((2 * 1024 * 1024) + 1));
        return commandResult("build ok");
      }
      return commandResult();
    });

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("failed");
    expect(session.validationReport?.summary).toContain("artifact file is too large");
    expect(dashboards.getDashboardById(dashboardId)?.publishedRevisionId).toBeNull();
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "create")).toBe(false);
  });

  it("retrieves bounded validation logs from the persisted log file and container logs", async () => {
    const { service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    const logs = await service.getValidationLogs(session.id, 20);

    expect(logs.logs).toContain("install ok");
    expect(logs.logs).toContain("vite preview ready");
  });

  it("rejects malformed or oversized proxy request bodies before forwarding", async () => {
    const { service } = await createFixture();

    await expect(service.proxyValidationRequest({
      sessionId: "validation-session",
      method: "POST",
      path: "/api/test",
      bodyBytes: "not-a-buffer" as unknown as Buffer,
    })).rejects.toThrow("Request body must be a Buffer");

    await expect(service.proxyValidationRequest({
      sessionId: "validation-session",
      method: "POST",
      path: "/api/test",
      bodyBytes: Buffer.alloc((5 * 1024 * 1024) + 1),
    })).rejects.toThrow("Request body exceeds maximum allowed size");
  });

  it("preserves declared route context in validation proxy preview queries", async () => {
    const { service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);
    const fetchMock = vi.mocked((service as unknown as { fetchImpl: typeof fetch }).fetchImpl);

    await service.proxyValidationRequest({
      sessionId: session.id,
      method: "GET",
      path: "/?route=%2Fdetails",
    });

    const proxiedUrl = fetchMock.mock.calls.at(-1)?.[0];
    expect(String(proxiedUrl)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?route=%2Fdetails$/);
  });

  it("stops and removes validation sessions without invalidating passed revisions", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    const stopped = await service.stopValidation(session.id);
    expect(stopped.status).toBe("passed");
    expect(stopped.validationReport?.valid).toBe(true);
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("passed");

    await service.removeValidation(session.id);

    expect(dashboards.getValidationSessionById(session.id)).toBeNull();
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("passed");
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "rm" && args.includes("container-123"))).toBe(true);
  });

  it("lists validation sessions by project and optional dashboard", async () => {
    const { service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    await expect(service.getValidationSession(session.id)).resolves.toMatchObject({ id: session.id });
    await expect(service.listValidationSessions(projectId)).resolves.toEqual([expect.objectContaining({ id: session.id })]);
    await expect(service.listValidationSessions(projectId, dashboardId)).resolves.toEqual([expect.objectContaining({ id: session.id })]);
  });
});
