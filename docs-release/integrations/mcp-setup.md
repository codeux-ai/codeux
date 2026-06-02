# MCP Setup Guide

## Overview
This guide will walk you through enabling the Model Context Protocol (MCP) server in the app settings and connecting an external client (like Claude Desktop) to it.

::: info
The MCP server operates via stdio, allowing direct command-line execution and integration with external tools without needing network port configurations.
:::

## Prerequisites
* The Code UX application installed.
* An external client supporting MCP (e.g., Claude Desktop).
* Node.js and npx available in your environment.

## Steps

1. **Enable the MCP Server in Settings**
   Navigate to the **Dashboard**, open **Settings**, and locate the MCP configuration to ensure it is enabled for external connections.

2. **Connect Claude Desktop**
   Add the following configuration to your Claude Desktop configuration file (`claude_desktop_config.json`). This executes the MCP server via `stdio`:

   ```json
   {
     "mcpServers": {
      "code-ux": {
        "command": "npx",
        "args": ["-y", "codeux"],
         "env": {
           "JULES_API_KEY": "your_api_key_here"
         }
       }
     }
   }
   ```

3. **Verify Connection**
   Once connected, open your external client and try an example prompt such as:
   * **"Summarize my tasks"**
   * **"List my active sprints"**

## Troubleshooting

### Connection Refused or Startup Errors
If the client cannot connect, ensure your Node.js environment is configured correctly. Because the server uses `stdio`, "connection refused" typically means the process failed to start.
* Check that `npx -y codeux` runs successfully in a standalone terminal.
* Verify your `JULES_API_KEY` is correct in the environment configuration block.

## Expected Result
You should be able to send the example prompt **"Summarize my tasks"** in Claude Desktop and receive a summary of your active tasks directly from the Code UX environment.
