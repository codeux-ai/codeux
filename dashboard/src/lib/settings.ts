import type { DashboardSettings } from "../types.js";

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  automationLevel: "SEMI_AUTO",
  aiProvider: {
    provider: "jules",
    julesApiKey: "",
  },
  git: {
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: "feature/sprint{sprint}-implementation",
  },
  skills: [
    { name: "orchestrator", enabled: true, isInternal: true },
    { name: "worker", enabled: true, isInternal: true },
    { name: "watch", enabled: true, isInternal: true },
    { name: "watch-skill", enabled: true, isInternal: true },
    { name: "sprint_agent_guide", enabled: true, isInternal: true },
  ],
};

export const cloneDefaultSettings = (): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  aiProvider: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider },
  git: { ...DEFAULT_DASHBOARD_SETTINGS.git },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
});
