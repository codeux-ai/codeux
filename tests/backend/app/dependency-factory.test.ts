import { beforeEach, describe, expect, it, vi } from "vitest";

const factoryMocks = vi.hoisted(() => ({
  createCoreDependencies: vi.fn(),
  createSprintDependencies: vi.fn(),
  createDashboardDependencies: vi.fn(),
  createMcpDependencies: vi.fn(),
}));

vi.mock("../../../src/app/dependency-factory/core-factory.js", () => ({
  createCoreDependencies: factoryMocks.createCoreDependencies,
}));
vi.mock("../../../src/app/dependency-factory/sprint-factory.js", () => ({
  createSprintDependencies: factoryMocks.createSprintDependencies,
}));
vi.mock("../../../src/app/dependency-factory/dashboard-factory.js", () => ({
  createDashboardDependencies: factoryMocks.createDashboardDependencies,
}));
vi.mock("../../../src/app/dependency-factory/mcp-factory.js", () => ({
  createMcpDependencies: factoryMocks.createMcpDependencies,
}));

import { createRuntimeDependencies } from "../../../src/app/dependency-factory.js";

describe("runtime dependency factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects the continuation-enabled MCP management handler for the server runtime", () => {
    const coreDeps = { coreDependency: true };
    const sprintDeps = { sprintDependency: true };
    const dashboardHandler = { source: "dashboard" };
    const dashboardDeps = {
      dashboardDependency: true,
      managementToolHandler: dashboardHandler,
    };
    const mcpHandler = { source: "mcp-continuation" };
    const mcpDeps = { managementToolHandler: mcpHandler };
    factoryMocks.createCoreDependencies.mockReturnValue(coreDeps);
    factoryMocks.createSprintDependencies.mockReturnValue(sprintDeps);
    factoryMocks.createDashboardDependencies.mockReturnValue(dashboardDeps);
    factoryMocks.createMcpDependencies.mockReturnValue(mcpDeps);

    const options = { projectRoot: "/repo", appConfig: {} };
    const context = {};
    const result = createRuntimeDependencies(options as never, context as never);

    expect(factoryMocks.createDashboardDependencies).toHaveBeenCalledWith(context, coreDeps, sprintDeps);
    expect(factoryMocks.createMcpDependencies).toHaveBeenCalledWith(context, coreDeps, sprintDeps, dashboardDeps);
    expect(result.managementToolHandler).toBe(mcpHandler);
    expect(result).toMatchObject({
      coreDependency: true,
      sprintDependency: true,
      dashboardDependency: true,
    });
  });
});
