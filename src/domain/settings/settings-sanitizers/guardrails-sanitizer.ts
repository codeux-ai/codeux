import type {
  DashboardSettings,
  GuardrailJobConfig,
  GuardrailJobType,
  GuardrailOnLimitAction,
} from "../../../contracts/app-types.js";
import { readBoolean, readInteger } from "../../../shared/config/value-readers.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  GUARDRAIL_JOB_TYPES,
  GUARDRAIL_ON_LIMIT_ACTIONS,
  LEGACY_CLARIFICATION_RETRY_CAP,
  MAX_GUARDRAIL_CAP,
  MAX_GUARDRAIL_TOTAL_CEILING,
  MIN_GUARDRAIL_CAP,
  MIN_GUARDRAIL_TOTAL_CEILING,
} from "../../../repositories/settings-defaults.js";

const DEFAULT_GUARDRAILS = DEFAULT_DASHBOARD_SETTINGS.guardrails;

const readOnLimitAction = (value: unknown, fallback: GuardrailOnLimitAction): GuardrailOnLimitAction => {
  if (typeof value === "string" && GUARDRAIL_ON_LIMIT_ACTIONS.includes(value as GuardrailOnLimitAction)) {
    return value as GuardrailOnLimitAction;
  }
  return fallback;
};

const clampCap = (value: unknown, fallback: number): number =>
  Math.min(MAX_GUARDRAIL_CAP, Math.max(MIN_GUARDRAIL_CAP, readInteger(value, fallback)));

/**
 * Sanitizes the guardrails settings block.
 *
 * Back-compat: when the guardrails block (or an individual job entry) is absent — i.e. an
 * upgrade from a config predating guardrails — the absorbed legacy caps are migrated:
 * `ci_fix` seeds from `ciIntelligence.julesCiAutofixMaxRetries`, and `clarification_reply`
 * seeds from the historical hardcoded limit of 3.
 */
export const sanitizeGuardrails = (
  input: Partial<DashboardSettings> | undefined,
): DashboardSettings["guardrails"] => {
  const guardrailsInput = (input?.guardrails && typeof input.guardrails === "object"
    ? input.guardrails
    : {}) as Partial<DashboardSettings["guardrails"]>;
  const jobsInput = (guardrailsInput.jobs && typeof guardrailsInput.jobs === "object"
    ? guardrailsInput.jobs
    : {}) as Partial<Record<GuardrailJobType, Partial<GuardrailJobConfig>>>;

  // Legacy migration sources (only used when the corresponding job entry is missing).
  const legacyCiFixCap = readInteger(
    input?.ciIntelligence?.julesCiAutofixMaxRetries,
    DEFAULT_GUARDRAILS.jobs.ci_fix.cap,
  );

  const legacyCapFallbacks: Record<GuardrailJobType, number> = {
    task_coding: DEFAULT_GUARDRAILS.jobs.task_coding.cap,
    ci_fix: legacyCiFixCap,
    merge_conflict: DEFAULT_GUARDRAILS.jobs.merge_conflict.cap,
    clarification_reply: LEGACY_CLARIFICATION_RETRY_CAP,
    planning: DEFAULT_GUARDRAILS.jobs.planning.cap,
  };

  const jobs = GUARDRAIL_JOB_TYPES.reduce((acc, jobType) => {
    const jobInput = (jobsInput[jobType] && typeof jobsInput[jobType] === "object"
      ? jobsInput[jobType]
      : undefined) as Partial<GuardrailJobConfig> | undefined;
    const defaults = DEFAULT_GUARDRAILS.jobs[jobType];
    acc[jobType] = {
      cap: clampCap(jobInput?.cap, jobInput === undefined ? legacyCapFallbacks[jobType] : defaults.cap),
      onLimit: readOnLimitAction(jobInput?.onLimit, defaults.onLimit),
    };
    return acc;
  }, {} as Record<GuardrailJobType, GuardrailJobConfig>);

  return {
    enabled: readBoolean(guardrailsInput.enabled, DEFAULT_GUARDRAILS.enabled),
    perTaskTotalCeiling: Math.min(
      MAX_GUARDRAIL_TOTAL_CEILING,
      Math.max(
        MIN_GUARDRAIL_TOTAL_CEILING,
        readInteger(guardrailsInput.perTaskTotalCeiling, DEFAULT_GUARDRAILS.perTaskTotalCeiling),
      ),
    ),
    jobs,
  };
};
