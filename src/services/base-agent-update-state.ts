import { createHash } from "node:crypto";
import type {
  BaseAgentInstructionState,
  BaseAgentInstructionStates,
  BaseAgentRole,
} from "../contracts/agent-preset-types.js";

export interface BaseAgentRoleDefinition {
  role: BaseAgentRole;
  name: "Planning agent" | "Project manager";
  fileName: "planning_agent.md" | "project_manager.md";
  routingKey: "planning" | "dashboardReply";
}

export const BASE_AGENT_ROLE_DEFINITIONS: readonly BaseAgentRoleDefinition[] = [
  {
    role: "planning_agent",
    name: "Planning agent",
    fileName: "planning_agent.md",
    routingKey: "planning",
  },
  {
    role: "project_manager",
    name: "Project manager",
    fileName: "project_manager.md",
    routingKey: "dashboardReply",
  },
];

export function getBaseAgentRoleDefinition(role: BaseAgentRole): BaseAgentRoleDefinition {
  return BASE_AGENT_ROLE_DEFINITIONS.find((definition) => definition.role === role)!;
}

export function resolveBaseAgentRole(name: string): BaseAgentRole | null {
  const normalized = name.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (normalized === "planning agent") return "planning_agent";
  if (normalized === "project manager" || normalized === "iris") return "project_manager";
  return null;
}

export function hashBaseAgentInstructions(instructionMarkdown: string): string {
  const normalized = instructionMarkdown.replace(/\r\n?/g, "\n").trim();
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function createBaseAgentInstructionState(
  role: BaseAgentRole,
  baselineContentHash: string,
  customized: boolean,
  lastAppliedRevision: string | null,
): BaseAgentInstructionState {
  return { role, baselineContentHash, customized, lastAppliedRevision };
}

export function parseBaseAgentInstructionStates(value: unknown): BaseAgentInstructionStates | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const result: BaseAgentInstructionStates = {};
  for (const definition of BASE_AGENT_ROLE_DEFINITIONS) {
    const candidate = (value as Record<string, unknown>)[definition.role];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (record.role !== definition.role || typeof record.baselineContentHash !== "string") continue;
    result[definition.role] = {
      role: definition.role,
      baselineContentHash: record.baselineContentHash,
      customized: record.customized === true,
      lastAppliedRevision: typeof record.lastAppliedRevision === "string" ? record.lastAppliedRevision : null,
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
