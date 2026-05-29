# Model Context Protocol (MCP) Overview

## Before you start
Familiarity with basic AI concepts is helpful but not required to understand this guide.

## What is MCP?
The Model Context Protocol (MCP) is a feature that enables AI models to safely read and write specific parts of our application context. In plain language, it acts as a secure bridge that allows the AI to see relevant project information so it can assist you better, without giving it unrestricted access to your entire system.

## Supported AI Models and Capabilities
The MCP integration supports several advanced AI models designed to improve your workflow:
- **Jules**: Orchestrates sprint planning, manages codebase changes, and executes complex subtasks.
- **Qwen**: Assists with auto-drafting documentation and generating context-aware code snippets.
- **Codex**: Ideal for querying project state and understanding existing code structures.

## Security Boundary
Protecting your data is our top priority. The MCP integration enforces a strict security boundary:
- **What the AI can access**: Only specific, authorized information such as designated project files, current sprint data, and relevant code context.
- **What the AI cannot access**: It cannot access system secrets, environment variables, or private credentials. All actions are confined to a secure sandbox, ensuring your broader system remains untouched.

## Expected Result
You should now have a clear understanding of what MCP is, which AI models are supported, and how the security boundaries protect your application context.
