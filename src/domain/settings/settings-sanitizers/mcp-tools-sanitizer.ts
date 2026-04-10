import type { McpToolToggle } from "../../../contracts/app-types.js";

export function cloneMcpTools(tools: McpToolToggle[]): McpToolToggle[] {
  return tools.map((tool) => ({ ...tool }));
}
