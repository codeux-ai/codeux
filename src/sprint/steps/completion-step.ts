import type { CiIntelligenceSettings } from "../../contracts/app-types.js";
import type { InstructionTemplateId, InstructionTemplateVariables } from "../../instructions/instruction-template-catalog.js";

interface CompletionStepOptions {
  defaultBranch: string;
  featureBranch: string;
  sprintNumber: number;
  githubMode: "REMOTE" | "LOCAL";
  ciIntelligence: CiIntelligenceSettings;
  renderInstruction: <T extends InstructionTemplateId>(templateId: T, variables: InstructionTemplateVariables[T]) => Promise<string>;
}

const buildMainCiWaitLine = (settings: CiIntelligenceSettings): string => {
  if (!settings.enabled || settings.mainBranchAutoMergeMode !== "WHEN_GREEN") {
    return "";
  }
  return "2. **Wait for CI on main**: merge only after required checks are green.\n";
};

const buildMainCommentsLine = (settings: CiIntelligenceSettings): string => {
  if (!settings.enabled || !settings.resolveAllCommentsBeforeMainMerge) {
    return "";
  }
  return "3. **Resolve Review Comments**: ensure all PR comments are addressed before final merge.\n";
};

export const runCompletionStep = async (options: CompletionStepOptions): Promise<string> => {
  return await options.renderInstruction("completionSteps", {
    git_manager_skill: options.githubMode === "REMOTE" ? "`git_manager_remote`" : "`git_manager_local`",
    feature_branch: options.featureBranch,
    default_branch: options.defaultBranch,
    next_sprint: options.sprintNumber + 1,
    main_ci_wait_line: buildMainCiWaitLine(options.ciIntelligence),
    main_comments_line: buildMainCommentsLine(options.ciIntelligence),
  });
};
