import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerMcpRequestHandlers } from "./src/server/mcp-request-router.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS } from "./src/contracts/mcp-tool-definitions.js";

// Mock dependencies
const mockGetDashboardSettings = () => ({
  mcpTools: TOOL_DEFINITIONS.map(t => ({ name: t.name, enabled: true }))
});
const mockGetRuntimeRole = () => "project_manager" as any;
const mockFormatError = (e: any) => ({ content: [], isError: true });

const mockServer = new Server(
  {
    name: "test-server",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

const handlers: Record<string, Function> = {};
mockServer.setRequestHandler = (schema: any, handler: any) => {
  if (schema === ListToolsRequestSchema || schema?.method === "tools/list") {
     handlers["tools/list"] = handler;
  }
  if (schema === CallToolRequestSchema || schema?.method === "tools/call") {
     handlers["tools/call"] = handler;
  }
};

const mockCoreToolHandler = {} as any;
const mockAgentToolHandler = {} as any;
const mockManagementToolHandler = {
  handleManageProjects: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_projects"}' }] }),
  handleManageSprints: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_sprints"}' }] }),
  handleManageTasks: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_tasks"}' }] }),
  handleManageAgents: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_agents"}' }] }),
  handleManageMemory: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_memory"}' }] }),
  handleManageSettings: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_settings"}' }] }),
  handleManagePreview: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_preview"}' }] }),
  handleManageTelemetry: async () => ({ content: [{ type: "text", text: '{"status":"ok_manage_telemetry"}' }] }),
} as any;

// Register the handlers
registerMcpRequestHandlers({
  server: mockServer,
  coreToolHandler: mockCoreToolHandler,
  agentToolHandler: mockAgentToolHandler,
  managementToolHandler: mockManagementToolHandler,
  getDashboardSettings: mockGetDashboardSettings as any,
  getRuntimeRole: mockGetRuntimeRole,
  formatError: mockFormatError as any,
});

async function run() {
  if (!handlers["tools/list"]) {
    throw new Error("tools/list handler not registered");
  }

  const listResponse = await handlers["tools/list"]({ params: {} });

  const specializedTools = [
    "manage_projects",
    "manage_sprints",
    "manage_tasks",
    "manage_agents",
    "manage_memory",
    "manage_settings",
    "manage_preview",
    "manage_telemetry",
  ];

  const foundTools = listResponse.tools.map((t: any) => t.name);

  let missing = false;
  for (const tool of specializedTools) {
    if (!foundTools.includes(tool)) {
      console.error(`Missing tool in MCP tools/list: ${tool}`);
      missing = true;
    }
  }

  if (missing) {
    process.exit(1);
  } else {
    console.log("All specialized tools are successfully registered and listed!");
  }

  // Now verify that the mock works by calling one of them
  const callResponse = await handlers["tools/call"]({
    params: {
        name: "manage_projects",
        arguments: { action: "list", projectId: "123" }
    }
  });

  if (callResponse?.content?.[0]?.text === '{"status":"ok_manage_projects"}') {
      console.log("Tool dispatch routing works successfully!");
  } else {
      console.error("Tool dispatch failed or returned unexpected response", callResponse);
      process.exit(1);
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
