import type { DashboardSettings, ProviderId } from "../types.js";
import { sanitizeSystemProviderConfig } from "../v2/lib/provider-runtime-preview.js";

const syncGitManagerSkills = (
  skills: DashboardSettings["skills"],
  githubMode: DashboardSettings["git"]["githubMode"]
): DashboardSettings["skills"] => {
  return skills.map((skill) => {
    if (skill.name === "git_manager_remote") {
      return { ...skill, enabled: githubMode === "REMOTE" };
    }
    if (skill.name === "git_manager_local") {
      return { ...skill, enabled: githubMode === "LOCAL" };
    }
    if (skill.name === "git_manager") {
      return { ...skill, enabled: true };
    }
    return skill;
  });
};

export const updateAiProvider = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["aiProvider"]>
): DashboardSettings => {
  return {
    ...settings,
    aiProvider: {
      ...settings.aiProvider,
      ...patch,
    },
  };
};

export const updateProviderConfig = (
  settings: DashboardSettings,
  providerId: ProviderId,
  patch: Partial<DashboardSettings["aiProvider"]["providers"][ProviderId]>
): DashboardSettings => {
  const nextProviderConfig = sanitizeSystemProviderConfig({
    ...settings.aiProvider.providers[providerId],
    ...patch,
  });

  const hasApiKeyPatch = Object.prototype.hasOwnProperty.call(patch, "apiKey");

  return updateAiProvider(settings, {
    ...(providerId === "jules" && hasApiKeyPatch ? { julesApiKey: nextProviderConfig.apiKey } : {}),
    providers: {
      ...settings.aiProvider.providers,
      [providerId]: nextProviderConfig,
    },
  });
};

export const updateGitSettings = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["git"]>
): DashboardSettings => {
  return {
    ...settings,
    git: {
      ...settings.git,
      ...patch,
    },
  };
};

export const updateGitHubMode = (
  settings: DashboardSettings,
  githubMode: DashboardSettings["git"]["githubMode"]
): DashboardSettings => {
  return {
    ...updateGitSettings(settings, { githubMode }),
    skills: syncGitManagerSkills(settings.skills, githubMode),
  };
};

export const updateCiIntelligence = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["ciIntelligence"]>
): DashboardSettings => {
  return {
    ...settings,
    ciIntelligence: {
      ...settings.ciIntelligence,
      ...patch,
    },
  };
};

export const updateSprintLoopSteps = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["sprintLoopSteps"]>
): DashboardSettings => {
  return {
    ...settings,
    sprintLoopSteps: {
      ...settings.sprintLoopSteps,
      ...patch,
    },
  };
};

export const updateSprintLoopStep = <K extends keyof DashboardSettings["sprintLoopSteps"]>(
  settings: DashboardSettings,
  step: K,
  value: DashboardSettings["sprintLoopSteps"][K]
): DashboardSettings => {
  return updateSprintLoopSteps(settings, {
    [step]: value,
  } as Pick<DashboardSettings["sprintLoopSteps"], K>);
};

export const updateCliWorkflow = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["cliWorkflow"]>
): DashboardSettings => {
  return {
    ...settings,
    cliWorkflow: {
      ...settings.cliWorkflow,
      ...patch,
    },
  };
};

export const updateWorkers = (
  settings: DashboardSettings,
  patch: Partial<DashboardSettings["workers"]>
): DashboardSettings => {
  return {
    ...settings,
    workers: {
      ...settings.workers,
      ...patch,
    },
  };
};
