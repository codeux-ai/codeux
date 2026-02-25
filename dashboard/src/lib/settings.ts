import type { DashboardSettings } from "../types.js";

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  automationLevel: "SEMI_AUTO",
  aiProvider: {
    provider: "jules",
    julesApiKey: "",
  },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: "feature/sprint{sprint}-implementation",
  },
  ciIntelligence: {
    enabled: true,
    waitForCiBeforeMainMerge: true,
    resolveAllCommentsBeforeMainMerge: true,
    waitForCiBeforeFeatureMerge: true,
    resolveAllCommentsBeforeFeatureMerge: true,
  },
  sprintLoopSteps: {
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
  },
  skills: [
    { name: "orchestrator", enabled: true, isInternal: true },
    { name: "worker", enabled: true, isInternal: true },
    { name: "watch", enabled: true, isInternal: true },
    { name: "watch-skill", enabled: true, isInternal: true },
    { name: "sprint_agent_guide", enabled: true, isInternal: true },
    { name: "git_manager", enabled: true, isInternal: true },
    { name: "git_manager_remote", enabled: true, isInternal: true },
    { name: "git_manager_local", enabled: false, isInternal: true },
  ],
};

export const cloneDefaultSettings = (): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  aiProvider: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider },
  git: { ...DEFAULT_DASHBOARD_SETTINGS.git },
  ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
  sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
});
