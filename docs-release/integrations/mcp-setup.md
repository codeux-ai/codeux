# Configure MCP Features

## Before you start
This guide will walk you through enabling the Model Context Protocol (MCP) server within Sprint OS and connecting an external client like Claude Desktop. What you will accomplish is a secure, local connection between an external AI tool and your local sprint data.

::: info
By default, the MCP HTTPS server is enabled but you must know the specific port and host configurations to connect an external client.
:::

## Prerequisites
* Installed Sprint OS
* An external client supporting MCP (e.g., Claude Desktop)
* Familiarity with editing JSON configuration files (for your external client)

::: warning
Ensure you do not expose your MCP port to the public internet unless you have configured authentication tokens (`MCP_HTTPS_AUTH_TOKEN`).
:::

## Steps

1. **Enable the MCP Server**
   Start Sprint OS with the MCP server enabled. It is enabled by default, but you can explicitly enable it using the `--mcp-https` flag or by setting the `MCP_HTTPS_ENABLED` environment variable to `true`.
   To specify a port, use the `--mcp-https-port` flag or the `MCP_HTTPS_PORT` environment variable. If not specified, it will default to the dashboard port plus one (e.g., if dashboard is 4444, MCP is 4445).

   ```bash
   node dist/index.js --mcp-https --mcp-https-port 4445
   ```

2. **Configure Claude Desktop**
   Open your Claude Desktop configuration file (usually located at `~/.claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows).

3. **Add the MCP Connection Details**
   Add the connection block pointing to your local Sprint OS instance. Ensure you use the exact port you configured in Step 1.

   ```json
   {
     "mcpServers": {
       "sprint-os": {
         "command": "node",
         "args": ["path/to/sprint-os/dist/index.js", "--mcp-https", "--mcp-https-port", "4445"]
       }
     }
   }
   ```
   *Note: If you are connecting via HTTP transport instead of stdio, your client must support SSE (Server-Sent Events) on the configured path (default `/mcp`).*

4. **Test the Connection with Prompts**
   Restart Claude Desktop. You should now be able to interact with Sprint OS.

::: tip
Try these example prompts in Claude Desktop to verify the connection:
* "Summarize my tasks"
* "List all projects in the workspace"
* "What are my attention items?"
:::

## Expected Result
You should see Claude Desktop respond with your actual project data from Sprint OS, confirming that the MCP integration is working correctly.

## Troubleshooting

### Connection Refused Errors
If you experience a "Connection Refused" error, check the following:
* Verify that Sprint OS is actually running and you haven't closed the terminal.
* Double-check the exact port number in your client's configuration matches the `MCP_HTTPS_PORT` or the fallback default (Dashboard port + 1).
* If binding to a non-loopback host (e.g., `0.0.0.0`), ensure you have provided the `--mcp-https-auth-token`. Sprint OS will refuse to start on a non-loopback interface without an auth token for security.
