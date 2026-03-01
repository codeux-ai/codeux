import type {
  AutomationInterventionsSettings,
  CiIntelligenceSettings,
  SprintLoopStepSettings,
} from "../contracts/app-types.js";

export const DEFAULT_SPRINT_LOOP_STEP_SETTINGS: SprintLoopStepSettings = {
  branchPreflight: true,
  planningPreflight: true,
  loadSubtasks: true,
  sessionSync: true,
  statusDerivation: true,
  startReadyTasks: true,
  mergeProtocol: true,
  actionRequiredProtocol: true,
  statusTable: true,
  watchLoop: true,
  watchLoopIntervalSeconds: 120,
  watchLoopOutputIntervalSeconds: 300,
};

export const DEFAULT_CI_INTELLIGENCE_SETTINGS: CiIntelligenceSettings = {
  enabled: true,
  enableLivePrMonitoring: true,
  waitForCiBeforeMainMerge: true,
  resolveAllCommentsBeforeMainMerge: true,
  waitForCiBeforeFeatureMerge: true,
  resolveAllCommentsBeforeFeatureMerge: true,
  waitForJulesCiAutofix: false,
  julesCiAutofixMaxRetries: 3,
  autoMergeFeaturePrWhenGreen: false,
};

export const DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS: AutomationInterventionsSettings = {
  autoApprovePlan: true,
  autoAnswerClarification: false,
  autoResumePaused: false,
  clarificationAnswerTemplate:
    "Proceed with the safest implementation path using repository conventions. If multiple valid options exist, choose the smallest-scope option and continue without waiting for clarification.",
};
