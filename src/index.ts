#!/usr/bin/env node
import { installRuntimeWarningFilter } from "./runtime-warning-filter.js";

installRuntimeWarningFilter();

export async function main(args: string[] = process.argv): Promise<void> {
  const [
    dotenv,
    path,
    { fileURLToPath },
    { loadAppConfig },
    { JulesAgentServer },
  ] = await Promise.all([
    import("dotenv"),
    import("path"),
    import("url"),
    import("./config/app-config.js"),
    import("./server/jules-agent-server.js"),
  ]);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
  const appConfig = loadAppConfig(args, projectRoot);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("Code UX MCP Server");
    console.log("");
    console.log("Usage: code-ux [options]");
    console.log("");
    console.log("Options:");
    console.log("  --api-key VALUE   Set the Jules API key (overrides env and settings)");
    console.log("  --runtime-role VALUE");
    console.log("                    Runtime role: project_manager (default) or worker-host");
    console.log("  --headless        Start MCP-only without binding the dashboard");
    console.log("  --mcp-http        Enable the remote MCP HTTP worker gateway");
    console.log("  --mcp-http-port N Port for the remote MCP HTTP worker gateway");
    console.log("  --mcp-http-host H Host/interface for the remote MCP HTTP worker gateway");
    console.log("  --mcp-http-path P Path for the remote MCP HTTP worker gateway (default: /mcp)");
    console.log("  --mcp-http-auth-token VALUE");
    console.log("                    Bearer token required for MCP HTTP requests when enabled");
    console.log("  --help, -h        Show this help message");
    console.log("");
    console.log("Environment Variables:");
    console.log("  JULES_API_KEY     Jules API key");
    console.log("  DASHBOARD_PORT    Port for the dashboard (default: 4444)");
    console.log("  MCP_HTTP_ENABLED  Enable the MCP HTTP worker gateway");
    console.log("  MCP_HTTP_PORT     Port for the MCP HTTP worker gateway");
    console.log("  MCP_HTTP_HOST     Host/interface for the MCP HTTP worker gateway");
    console.log("  MCP_HTTP_PATH     Path for the MCP HTTP worker gateway");
    console.log("  MCP_HTTP_AUTH_TOKEN");
    console.log("                    Bearer token for MCP HTTP requests");
    process.exit(0);
  }

  const server = new JulesAgentServer({ projectRoot, appConfig });

  try {
    await server.run();
  } catch (error) {
    console.error("Fatal error starting server:", error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  });
}
