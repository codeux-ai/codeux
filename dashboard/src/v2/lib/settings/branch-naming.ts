import {
  BRANCH_NAME_TOKENS,
  BRANCH_NAME_TOKEN_ALIASES,
  type BranchNameToken,
} from "../../../../../src/domain/settings/branch-name-tokens.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateSettingsOperationsMessage } from "../../i18n/messages/settings-operations.js";

export interface BranchSchemeOption {
  value: string;
  label: string;
}

export const BRANCH_NAME_TOKEN_LABELS = {
  sprint_key_prefix: "Sprint Key Prefix",
  sprint_number: "Sprint Number",
  sprint_name: "Sprint Name",
  sprint_id: "Sprint ID",
  planning_agent: "Planning Agent",
  agent_routing: "Agent Routing",
  worker_agent: "Worker Agent",
  worker_provider: "Worker Provider",
  worker_model: "Worker Model",
} as const satisfies Record<BranchNameToken, string>;

export const TASK_PR_TITLE_TOKEN_LABELS = {
  sprint_tag: "Sprint Tag",
  sprint_key: "Sprint Key",
  sprint_number: "Sprint Number",
  sprint_title: "Sprint Title",
  task_key: "Task Key",
  task_title: "Task Title",
  provider: "Provider",
} as const;

export type TaskPrTitleToken = keyof typeof TASK_PR_TITLE_TOKEN_LABELS;

export const getBranchNameTokenLabels = (
  locale: DashboardLocale,
): Record<BranchNameToken, string> => Object.fromEntries(
  Object.entries(BRANCH_NAME_TOKEN_LABELS).map(([token, label]) => [
    token,
    translateSettingsOperationsMessage(locale, label),
  ]),
) as Record<BranchNameToken, string>;

export const getTaskPrTitleTokenLabels = (
  locale: DashboardLocale,
): Record<TaskPrTitleToken, string> => Object.fromEntries(
  Object.entries(TASK_PR_TITLE_TOKEN_LABELS).map(([token, label]) => [
    token,
    translateSettingsOperationsMessage(locale, label),
  ]),
) as Record<TaskPrTitleToken, string>;

export const getCanonicalBranchNameToken = (tokenOrScheme: string): BranchNameToken => {
  const match = tokenOrScheme.match(/\{([^}]+)\}/);
  const token = match ? match[1] : tokenOrScheme;
  return BRANCH_NAME_TOKEN_ALIASES[token] || (BRANCH_NAME_TOKENS.includes(token as BranchNameToken) ? (token as BranchNameToken) : "sprint_id");
};

export const getBranchSchemeOptions = (locale: DashboardLocale = "en"): BranchSchemeOption[] => {
  const labels = getBranchNameTokenLabels(locale);
  return (
  BRANCH_NAME_TOKENS.map((token) => ({
    value: `{${token}}`,
    label: labels[token],
  }))
  );
};

export const getTaskPrTitleSchemeOptions = (locale: DashboardLocale = "en"): BranchSchemeOption[] => (
  Object.entries(getTaskPrTitleTokenLabels(locale)).map(([token, label]) => ({
    value: `{${token}}`,
    label,
  }))
);
