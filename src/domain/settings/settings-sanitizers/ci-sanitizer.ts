import type { DashboardSettings, FeaturePrAutoMergeMode } from "../../../contracts/app-types.js";
import { readBoolean, readInteger } from "../../../shared/config/value-readers.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  FEATURE_PR_AUTOMERGE_MODES,
  MAX_JULES_CI_AUTOFIX_RETRIES,
  MIN_JULES_CI_AUTOFIX_RETRIES,
} from "../../../repositories/settings-defaults.js";

const readFeaturePrAutoMergeMode = (value: unknown, fallback: FeaturePrAutoMergeMode): FeaturePrAutoMergeMode => {
  if (typeof value === "string" && FEATURE_PR_AUTOMERGE_MODES.includes(value as FeaturePrAutoMergeMode)) {
    return value as FeaturePrAutoMergeMode;
  }
  return fallback;
};

export const sanitizeCiIntelligence = (
  input: Partial<DashboardSettings> | undefined,
  githubMode: "REMOTE" | "LOCAL"
): DashboardSettings["ciIntelligence"] => {
  const ciInput = (input?.ciIntelligence && typeof input.ciIntelligence === "object"
    ? input.ciIntelligence
    : {}) as Partial<DashboardSettings["ciIntelligence"]> & { autoMergeFeaturePrWhenGreen?: unknown };

  const ciIntelligence = {
    enabled: readBoolean(ciInput.enabled, DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.enabled),
    enableLivePrMonitoring: readBoolean(
      ciInput.enableLivePrMonitoring,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.enableLivePrMonitoring
    ),
    waitForCiBeforeMainMerge: readBoolean(
      ciInput.waitForCiBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeMainMerge
    ),
    resolveAllCommentsBeforeMainMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeMainMerge
    ),
    resolveMainMergeConflicts: readBoolean(
      ciInput.resolveMainMergeConflicts,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveMainMergeConflicts
    ),
    waitForCiBeforeFeatureMerge: readBoolean(
      ciInput.waitForCiBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeFeatureMerge
    ),
    resolveAllCommentsBeforeFeatureMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
    ),
    resolveMergeConflicts: readBoolean(
      ciInput.resolveMergeConflicts,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveMergeConflicts
    ),
    waitForJulesCiAutofix: readBoolean(
      ciInput.waitForJulesCiAutofix,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForJulesCiAutofix
    ),
    julesCiAutofixMaxRetries: Math.min(
      MAX_JULES_CI_AUTOFIX_RETRIES,
      Math.max(
        MIN_JULES_CI_AUTOFIX_RETRIES,
        readInteger(
          ciInput.julesCiAutofixMaxRetries,
          DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.julesCiAutofixMaxRetries
        )
      )
    ),
    featurePrAutoMergeMode: readFeaturePrAutoMergeMode(
      ciInput.featurePrAutoMergeMode,
      readBoolean(
        ciInput.autoMergeFeaturePrWhenGreen,
        false
      )
        ? "WHEN_GREEN"
        : DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.featurePrAutoMergeMode
    ),
  };

  if (githubMode === "LOCAL") {
    ciIntelligence.enableLivePrMonitoring = false;
  }

  return ciIntelligence;
};
