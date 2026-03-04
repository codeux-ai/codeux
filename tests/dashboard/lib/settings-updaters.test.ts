import { describe, expect, it } from "vitest";
import {
  updateAiProvider,
  updateCiIntelligence,
  updateCliWorkflow,
  updateGitHubMode,
  updateGitSettings,
  updateProviderConfig,
  updateSprintLoopStep,
  updateSprintLoopSteps,
} from "../../../dashboard/src/lib/settings-updaters.js";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";

const getSkillEnabled = (skills: ReturnType<typeof cloneDefaultSettings>["skills"], name: string): boolean => {
  const skill = skills.find((entry) => entry.name === name);
  if (!skill) {
    throw new Error(`missing skill: ${name}`);
  }
  return skill.enabled;
};

describe("dashboard settings updater helpers", () => {
  it("updates ai provider section immutably", () => {
    const settings = cloneDefaultSettings();

    const next = updateAiProvider(settings, { strategy: "WEIGHTED", provider: "gemini" });

    expect(next.aiProvider.strategy).toBe("WEIGHTED");
    expect(next.aiProvider.provider).toBe("gemini");
    expect(settings.aiProvider.strategy).toBe("MANUAL");
    expect(settings.aiProvider.provider).toBe("jules");
    expect(next).not.toBe(settings);
    expect(next.aiProvider).not.toBe(settings.aiProvider);
    expect(next.git).toBe(settings.git);
  });

  it("updates individual provider config without mutating siblings", () => {
    const settings = cloneDefaultSettings();

    const next = updateProviderConfig(settings, "gemini", { model: "gemini-2.5-pro", weight: 35 });

    expect(next.aiProvider.providers.gemini.model).toBe("gemini-2.5-pro");
    expect(next.aiProvider.providers.gemini.weight).toBe(35);
    expect(settings.aiProvider.providers.gemini.model).toBe("default");
    expect(settings.aiProvider.providers.gemini.weight).toBe(20);
    expect(next.aiProvider.providers.jules).toBe(settings.aiProvider.providers.jules);
  });

  it("syncs aiProvider.julesApiKey when jules provider api key changes", () => {
    const settings = cloneDefaultSettings();

    const next = updateProviderConfig(settings, "jules", { apiKey: "jules-key" });

    expect(next.aiProvider.providers.jules.apiKey).toBe("jules-key");
    expect(next.aiProvider.julesApiKey).toBe("jules-key");
    expect(settings.aiProvider.julesApiKey).toBe("");
  });

  it("updates git settings and keeps git manager skills in sync with github mode", () => {
    const settings = cloneDefaultSettings();

    const renamed = updateGitSettings(settings, {
      defaultBranch: "develop",
      featureBranchPrefix: "feat/",
    });

    expect(renamed.git.defaultBranch).toBe("develop");
    expect(renamed.git.featureBranchPrefix).toBe("feat/");
    expect(settings.git.defaultBranch).toBe("main");

    const next = updateGitHubMode(settings, "LOCAL");

    expect(next.git.githubMode).toBe("LOCAL");
    expect(getSkillEnabled(next.skills, "git_manager_remote")).toBe(false);
    expect(getSkillEnabled(next.skills, "git_manager_local")).toBe(true);
    expect(getSkillEnabled(next.skills, "git_manager")).toBe(true);
    expect(getSkillEnabled(settings.skills, "git_manager_remote")).toBe(true);
    expect(getSkillEnabled(settings.skills, "git_manager_local")).toBe(false);
  });

  it("updates ci, sprint loop, and cli workflow sections immutably", () => {
    const settings = cloneDefaultSettings();

    const ci = updateCiIntelligence(settings, {
      waitForJulesCiAutofix: true,
      julesCiAutofixMaxRetries: 7,
    });
    expect(ci.ciIntelligence.waitForJulesCiAutofix).toBe(true);
    expect(ci.ciIntelligence.julesCiAutofixMaxRetries).toBe(7);
    expect(settings.ciIntelligence.waitForJulesCiAutofix).toBe(false);

    const loop = updateSprintLoopSteps(settings, {
      watchLoopIntervalSeconds: 45,
      watchLoopOutputIntervalSeconds: 600,
    });
    expect(loop.sprintLoopSteps.watchLoopIntervalSeconds).toBe(45);
    expect(loop.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(600);

    const loopSingle = updateSprintLoopStep(settings, "branchPreflight", false);
    expect(loopSingle.sprintLoopSteps.branchPreflight).toBe(false);
    expect(settings.sprintLoopSteps.branchPreflight).toBe(true);

    const workflow = updateCliWorkflow(settings, {
      executionMode: "DOCKER",
      containerImage: "node:22-bookworm",
    });
    expect(workflow.cliWorkflow.executionMode).toBe("DOCKER");
    expect(workflow.cliWorkflow.containerImage).toBe("node:22-bookworm");
    expect(settings.cliWorkflow.executionMode).toBe("HOST");
  });
});
