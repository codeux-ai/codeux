import AjvModule from "ajv";
import type { ErrorObject } from "ajv";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS } from "../../../contracts/mcp-tool-definitions.js";

const Ajv = AjvModule.default || AjvModule;
const ajv = new (Ajv as any)({ allErrors: true });

// Compile schemas for all tools
const validators = new Map<string, any>();

for (const tool of TOOL_DEFINITIONS) {
  if (tool.inputSchema) {
    validators.set(tool.name, ajv.compile(tool.inputSchema as any));
  }
}

export function validateToolArguments(toolName: string, args: unknown): void {
  const validator = validators.get(toolName);
  if (!validator) {
    // If there's no validator, we assume no arguments are required/defined.
    return;
  }

  const isValid = validator(args);
  if (!isValid) {
    const errors = validator.errors
      ?.map((err: ErrorObject) => {
        const path = err.instancePath ? `'${err.instancePath}' ` : "";
        return `${path}${err.message}`;
      })
      .join("; ");
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for tool ${toolName}: ${errors}`);
  }
}
