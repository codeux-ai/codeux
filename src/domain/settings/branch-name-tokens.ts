/**
 * Canonical branch-name tokens for sprint and agent identification.
 */
export const BRANCH_NAME_TOKENS = [
  "sprint_key_prefix",
  "sprint_number",
  "sprint_name",
  "sprint_id",
  "planning_agent",
  "agent_routing",
  "worker_agent",
  "worker_provider",
  "worker_model",
] as const;

export type BranchNameToken = (typeof BRANCH_NAME_TOKENS)[number];

/**
 * Mapping of legacy or alternate token aliases to canonical tokens.
 */
export const BRANCH_NAME_TOKEN_ALIASES: Record<string, BranchNameToken> = {
  sprint: "sprint_id",
  n: "sprint_number",
  sprintNumber: "sprint_number",
  sprintName: "sprint_name",
  workerProvider: "worker_provider",
  workerModel: "worker_model",
};
/**
 * Additional legacy tokens that are NOT part of the canonical set but allowed for compatibility.
 */
export const LEGACY_BRANCH_NAME_TOKENS = ["date", "taskCount"] as const;

/**
 * Metadata for branch name generation.
 */
export interface BranchNameMetadata {
  sprint_key_prefix: string;
  sprint_number: number;
  sprint_name: string;
  sprint_id: string;
  planning_agent: string;
  agent_routing: string;
  worker_agent: string;
  worker_provider: string;
  worker_model: string;
}
