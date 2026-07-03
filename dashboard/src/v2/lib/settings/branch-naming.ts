import {
  BRANCH_NAME_TOKENS,
  BRANCH_NAME_TOKEN_ALIASES,
  type BranchNameToken,
} from "../../../../../src/domain/settings/branch-name-tokens.js";

export interface BranchSchemeOption {
  value: string;
  label: string;
}

export const BRANCH_NAME_TOKEN_LABELS: Record<BranchNameToken, string> = {
  sprint_key_prefix: "Sprint Key Prefix",
  sprint_number: "Sprint Number",
  sprint_name: "Sprint Name",
  sprint_id: "Sprint ID",
  planning_agent: "Planning Agent",
  agent_routing: "Agent Routing",
  worker_agent: "Worker Agent",
  worker_provider: "Worker Provider",
  worker_model: "Worker Model",
};

export const getCanonicalBranchNameToken = (tokenOrScheme: string): BranchNameToken => {
  const match = tokenOrScheme.match(/\{([^}]+)\}/);
  const token = match ? match[1] : tokenOrScheme;
  return BRANCH_NAME_TOKEN_ALIASES[token] || (BRANCH_NAME_TOKENS.includes(token as BranchNameToken) ? (token as BranchNameToken) : "sprint_id");
};

export const getBranchSchemeOptions = (): BranchSchemeOption[] => (
  BRANCH_NAME_TOKENS.map((token) => ({
    value: `{${token}}`,
    label: BRANCH_NAME_TOKEN_LABELS[token],
  }))
);
