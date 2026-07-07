import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { buildHelpText, parseCliInvocation } from "../../../src/cli/cli-args.js";
import { runManagementCli } from "../../../src/cli/management-cli.js";

const createRuntimeDependenciesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/app/dependency-factory.js", () => ({
  createRuntimeDependencies: createRuntimeDependenciesMock,
}));

function createEnvelopeResponse(envelope: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(envelope, null, 2),
      },
    ],
  };
}

function createStreamPair(isTTY: boolean) {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
  const stdout = new PassThrough() as PassThrough & { isTTY?: boolean };
  const stderr = new PassThrough() as PassThrough & { isTTY?: boolean };
  stdin.isTTY = isTTY;
  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;
  return { stdin, stdout, stderr };
}

describe("management CLI", () => {
  const appConfig = {
    apiKey: null,
    baseUrl: "https://example.invalid",
    dashboardPort: 4444,
    apiKeyArg: null,
    runtimeRole: "project_manager" as const,
    serverMode: false,
    dashboardEnabled: true,
    mcpHttpEnabled: false,
    mcpHttpHost: "127.0.0.1",
    mcpHttpPort: null,
    mcpHttpPath: "/mcp",
    mcpHttpAuthToken: null,
  };

  beforeEach(() => {
    createRuntimeDependenciesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses human aliases for management commands", () => {
    const invocation = parseCliInvocation([
      "node",
      "codeux",
      "scheduler",
      "schedule-quicksprint",
      "--project",
      "project-1",
      "--template",
      "template-1",
      "--at",
      "2026-01-01T00:00:00Z",
      "--json",
    ]);

    expect(invocation.management?.domain).toBe("scheduler");
    expect(invocation.management?.action).toBe("schedule_quicksprint");
    expect(invocation.management?.jsonOutput).toBe(true);
    expect(invocation.management?.payloadFlags.projectId).toBe("project-1");
    expect(invocation.management?.payloadFlags.templateId).toBe("template-1");
    expect(invocation.management?.payloadFlags.scheduledFor).toBe("2026-01-01T00:00:00Z");
  });

  it("includes the management command section in the top-level help text", () => {
    const helpText = buildHelpText(appConfig);
    expect(helpText).toContain("Management commands:");
    expect(helpText).toContain("codeux manage --payload-json");
  });

  it("rejects missing required flags in non-TTY mode", async () => {
    const streams = createStreamPair(false);
    const invocation = parseCliInvocation(["node", "codeux", "projects", "get"]);

    await expect(runManagementCli({
      invocation,
      projectRoot: "/workspace",
      appConfig,
      io: streams,
      createDependencies: createRuntimeDependenciesMock as never,
    })).rejects.toThrow("Missing required flags: --project");
  });

  it("prompts for missing required flags when stdin is a TTY", async () => {
    const streams = createStreamPair(true);
    let stdoutText = "";
    streams.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf8");
    });
    const handler = {
      handleManageProjects: vi.fn().mockResolvedValue(createEnvelopeResponse({ result: { projects: [] } })),
      handleManageSprints: vi.fn(),
      handleManageTasks: vi.fn(),
      handleManageQuicksprints: vi.fn(),
      handleManageScheduler: vi.fn(),
      handleManageSettings: vi.fn(),
      handleManageAgents: vi.fn(),
      handleManageMemory: vi.fn(),
      handleManagePreview: vi.fn(),
      handleManageTelemetry: vi.fn(),
      handleManageCodeUx: vi.fn(),
      handleSearchKnowledge: vi.fn(),
    };

    createRuntimeDependenciesMock.mockReturnValue({ managementToolHandler: handler });

    const invocation = parseCliInvocation(["node", "codeux", "projects", "get"]);
    const runPromise = runManagementCli({
      invocation,
      projectRoot: "/workspace",
      appConfig,
      io: streams,
      createDependencies: createRuntimeDependenciesMock as unknown as typeof createRuntimeDependenciesMock,
    });

    setImmediate(() => {
      streams.stdin.write("project-123\n");
      streams.stdin.end();
    });

    await expect(runPromise).resolves.toBe(true);
    expect(handler.handleManageProjects).toHaveBeenCalledWith(expect.objectContaining({
      action: "get",
      payload: expect.objectContaining({ projectId: "project-123" }),
    }));
    expect(stdoutText).toContain("Project ID");
  });

  it("prints a raw JSON envelope when --json is supplied", async () => {
    const streams = createStreamPair(false);
    let stdoutText = "";
    streams.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf8");
    });
    const handler = {
      handleManageProjects: vi.fn().mockResolvedValue(createEnvelopeResponse({
        result: { projects: [{ id: "p1", name: "Alpha" }] },
      })),
      handleManageSprints: vi.fn(),
      handleManageTasks: vi.fn(),
      handleManageQuicksprints: vi.fn(),
      handleManageScheduler: vi.fn(),
      handleManageSettings: vi.fn(),
      handleManageAgents: vi.fn(),
      handleManageMemory: vi.fn(),
      handleManagePreview: vi.fn(),
      handleManageTelemetry: vi.fn(),
      handleManageCodeUx: vi.fn(),
      handleSearchKnowledge: vi.fn(),
    };

    createRuntimeDependenciesMock.mockReturnValue({ managementToolHandler: handler });

    const invocation = parseCliInvocation(["node", "codeux", "projects", "list", "--json"]);
    await expect(runManagementCli({
      invocation,
      projectRoot: "/workspace",
      appConfig,
      io: streams,
      createDependencies: createRuntimeDependenciesMock as never,
    })).resolves.toBe(true);

    expect(stdoutText).toContain('"projects"');
    expect(stdoutText).toContain('"Alpha"');
  });

  it("surfaces approval-required responses without auto-confirming", async () => {
    const streams = createStreamPair(false);
    let stdoutText = "";
    streams.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf8");
    });
    const handler = {
      handleManageProjects: vi.fn().mockResolvedValue(createEnvelopeResponse({
        approvalRequired: true,
        approvalMessage: "The action requires explicit approval.",
      })),
      handleManageSprints: vi.fn(),
      handleManageTasks: vi.fn(),
      handleManageQuicksprints: vi.fn(),
      handleManageScheduler: vi.fn(),
      handleManageSettings: vi.fn(),
      handleManageAgents: vi.fn(),
      handleManageMemory: vi.fn(),
      handleManagePreview: vi.fn(),
      handleManageTelemetry: vi.fn(),
      handleManageCodeUx: vi.fn(),
      handleSearchKnowledge: vi.fn(),
    };

    createRuntimeDependenciesMock.mockReturnValue({ managementToolHandler: handler });

    const invocation = parseCliInvocation(["node", "codeux", "projects", "delete", "--project", "p1"]);
    await expect(runManagementCli({
      invocation,
      projectRoot: "/workspace",
      appConfig,
      io: streams,
      createDependencies: createRuntimeDependenciesMock as never,
    })).resolves.toBe(true);

    expect(stdoutText).toContain("Approval required");
    expect(stdoutText).toContain("explicit approval");
    expect(handler.handleManageProjects).toHaveBeenCalledWith(expect.objectContaining({
      approval: undefined,
    }));
  });
});
