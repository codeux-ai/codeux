import { describe, expect, it, vi } from "vitest";
import { runCompletionStep } from "../../../../src/sprint/steps/completion-step.js";
import type { CiIntelligenceSettings } from "../../../../src/contracts/app-types.js";

describe("runCompletionStep", () => {
  it("renders instructions with default parameters", async () => {
    const renderInstruction = vi.fn().mockResolvedValue("Mock Instructions");
    const options = {
      defaultBranch: "main",
      featureBranch: "feature/SPR-1",
      sprintNumber: 1,
      githubMode: "REMOTE" as const,
      ciIntelligence: { enabled: false } as CiIntelligenceSettings,
      renderInstruction,
    };

    const result = await runCompletionStep(options);

    expect(result).toBe("Mock Instructions");
    expect(renderInstruction).toHaveBeenCalledWith("completionSteps", {
      git_manager_skill: "`git_manager_remote`",
      feature_branch: "feature/SPR-1",
      default_branch: "main",
      next_sprint: 2,
      main_ci_wait_line: "",
      main_comments_line: "",
    });
  });

  it("adds CI lines when CI intelligence is enabled", async () => {
    const renderInstruction = vi.fn().mockResolvedValue("Mock Instructions CI");
    const options = {
      defaultBranch: "develop",
      featureBranch: "feature/DEV-2",
      sprintNumber: 2,
      githubMode: "LOCAL" as const,
      ciIntelligence: {
        enabled: true,
        waitForCiBeforeMainMerge: true,
        resolveAllCommentsBeforeMainMerge: true,
      } as CiIntelligenceSettings,
      renderInstruction,
    };

    await runCompletionStep(options);

    expect(renderInstruction).toHaveBeenCalledWith("completionSteps", {
      git_manager_skill: "`git_manager_local`",
      feature_branch: "feature/DEV-2",
      default_branch: "develop",
      next_sprint: 3,
      main_ci_wait_line: "2. **Wait for CI on main**: merge only after required checks are green.\n",
      main_comments_line: "3. **Resolve Review Comments**: ensure all PR comments are addressed before final merge.\n",
    });
  });
});
