import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import type { JulesSession, Settings, Subtask } from "./types.js";
import type { JulesApiClient } from "./jules-api.js";

export interface SprintAgentArgs {
  sprint_number: number;
  repo_path: string;
  source_id: string;
  feature_branch?: string;
  action: "status" | "orchestrate" | "plan";
  wait?: boolean;
  retry_failed?: boolean;
}

export interface SprintOrchestratorDependencies {
  julesApi: JulesApiClient;
  settings: Settings;
  dashboardPort: number;
  completedSprints: Set<number>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<any[]>;
  loadSubtasks: (dir: string) => Promise<Subtask[]>;
  startJulesTask: (task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number) => Promise<JulesSession>;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  updateLastStatus: (status: any) => void;
}

export class SprintOrchestrator {
  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  private checkBranch(repoPath: string, branch: string): { existsLocal: boolean; existsRemote: boolean } {
    let existsLocal = false;
    let existsRemote = false;

    try {
      const stats = execSync(`[ -d "${repoPath}" ] && echo "dir" || echo "notdir"`, { encoding: "utf-8" }).trim();
      if (stats !== "dir") return { existsLocal, existsRemote };

      try {
        execSync("git rev-parse --is-inside-work-tree", { cwd: repoPath, stdio: "ignore" });
      } catch {
        return { existsLocal, existsRemote };
      }

      try {
        execSync(`git rev-parse --verify ${branch}`, { cwd: repoPath, stdio: "ignore" });
        existsLocal = true;
      } catch {}

      try {
        const remoteOutput = execSync(`git ls-remote --heads origin ${branch}`, { cwd: repoPath, encoding: "utf-8" });
        if (remoteOutput.trim()) existsRemote = true;
      } catch {}
    } catch (globalError) {
      console.error(`Warning in checkBranch: ${globalError instanceof Error ? globalError.message : String(globalError)}`);
    }

    return { existsLocal, existsRemote };
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const sprintsDir = path.join(args.repo_path, ".jules-subagents", "sprints");
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-implementation`;
    const retryFailed = args.retry_failed !== false;

    if (args.action === "plan" || args.action === "orchestrate") {
      const { existsLocal, existsRemote } = this.checkBranch(args.repo_path, defaultFeatureBranch);
      if (!existsLocal || !existsRemote) {
        let branchBlocker = `### 🛑 ACTION REQUIRED: Branch Configuration Missing\n\n`;
        branchBlocker += `The feature branch \`${defaultFeatureBranch}\` is not ready. Jules agents require this branch to exist on the remote repository to begin work.\n\n`;

        if (!existsLocal) {
          branchBlocker += `**Step 1:** Create the branch locally:\n\`\`\`bash\ngit checkout -b ${defaultFeatureBranch}\n\`\`\`\n\n`;
        }

        if (!existsRemote) {
          branchBlocker += `**Step ${!existsLocal ? "2" : "1"}:** Push the branch to remote origin:\n\`\`\`bash\ngit push -u origin ${defaultFeatureBranch}\n\`\`\`\n\n`;
        }

        branchBlocker += `**Important:** Once these steps are completed, run this tool again to proceed with the \`${args.action}\` phase.`;
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (args.action === "orchestrate" || args.action === "status") {
      try {
        await fs.access(subtasksDir);
        const files = await fs.readdir(subtasksDir);
        if (files.filter((f) => f.endsWith(".md")).length === 0) {
          throw new Error("No subtasks found");
        }
      } catch {
        let planBlocker = `### 🛑 ACTION REQUIRED: Sprint Planning Missing\n\n`;
        planBlocker += `No subtasks found in \`${subtasksDir}\`. You must plan the sprint before orchestration can begin.\n\n`;
        planBlocker += `**Instruction:** Run the \`sprint_agent\` with \`action: "plan"\` to initialize the subtasks and define the work items.`;
        return { content: [{ type: "text", text: planBlocker }] };
      }
    }

    if (this.deps.completedSprints.has(args.sprint_number)) {
      return { content: [{ type: "text", text: `Sprint ${args.sprint_number} has already been finished in this session.` }] };
    }

    if (args.action === "plan") {
      try {
        await fs.access(subtasksDir);
        return { content: [{ type: "text", text: `Subtasks directory already exists: ${subtasksDir}.` }] };
      } catch {
        await fs.mkdir(subtasksDir, { recursive: true });

        let planningGuide = "";
        try {
          planningGuide = await this.deps.getGuideContent("sprint_agent_guide.md", args.repo_path);
          planningGuide = `\n\n### Technical Operating Standard\n\n${planningGuide}\n`;
        } catch {}

        return {
          content: [{
            type: "text",
            text: `### Planning Phase for Sprint ${args.sprint_number}\n\n` +
              `Created directory: \`${subtasksDir}\`.\n\n` +
              planningGuide +
              `**Instructions for the calling Agent:**\n` +
              `1. Read \`sprints/sprint-${args.sprint_number}.md\`.\n` +
              `2. Break the sprint into small, well-planned tasks.\n` +
              `3. For each task, create a \`.md\` file in the subtasks directory with this format:\n\n` +
              "\`\`\`markdown\n" +
              "title: Task Title\n" +
              "depends_on: [task_id_1, task_id_2]\n" +
              "is_independent: true\n" +
              "merged: false\n" +
              "prompt:\n" +
              "Detailed instructions for Jules.\n" +
              "\`\`\`",
          }],
        };
      }
    }

    const runOrchestrationCycle = async () => {
      let subtasks: Subtask[] = [];
      try {
        subtasks = await this.deps.loadSubtasks(subtasksDir);
      } catch {
        throw new Error(`Error loading subtasks from ${subtasksDir}.`);
      }

      const sessionsResponse = await this.deps.julesApi.listSessions({ page_size: 100 });
      let sessions: JulesSession[] = sessionsResponse.sessions || [];

      sessions.sort((a, b) => {
        if (!a.createTime || !b.createTime) return 0;
        return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
      });

      for (const task of subtasks) {
        const match = sessions.find((s) => s.title?.includes(`[${task.id}]`));
        if (match) {
          const sessionName = this.deps.resolveSessionName(match);
          const sessionId = this.deps.extractSessionId(match);
          task.session_name = sessionName;
          task.session_id = sessionId;
          task.session_state = match.state;

          if (sessionName) {
            try {
              task.activities = await this.deps.fetchRecentActivities(sessionName, 5);
            } catch {
              console.error(`Warning: Could not fetch activities for task ${task.id}`);
            }
          }

          if (match.state === "COMPLETED") {
            task.status = "COMPLETED";
          } else if (match.state === "FAILED") {
            if (retryFailed) {
              const dependenciesMet = task.depends_on.every((depId) => {
                const dep = subtasks.find((t) => t.id === depId);
                return dep?.status === "COMPLETED" && dep?.is_merged;
              });
              task.status = dependenciesMet ? "PENDING" : "BLOCKED";
            } else {
              task.status = "FAILED";
            }
          } else if (this.deps.isActionRequiredState(match.state)) {
            task.status = "BLOCKED";
          } else {
            task.status = "RUNNING";
          }
        } else if (!task.is_independent) {
          task.status = "BLOCKED";
        } else {
          const dependenciesMet = task.depends_on.every((depId) => {
            const dep = subtasks.find((t) => t.id === depId);
            return dep?.status === "COMPLETED" && dep?.is_merged;
          });
          task.status = dependenciesMet ? "PENDING" : "BLOCKED";
        }
      }

      let reportText = "";
      let instructions = "";
      if (args.action === "orchestrate") {
        const maxFails = this.deps.settings.maxFailures || 5;
        if (this.deps.getConsecutiveFailures() >= maxFails) {
          throw new Error(`CRITICAL: Emergency stop active. ${this.deps.getConsecutiveFailures()} consecutive task creation failures detected. Please check configuration and run again to reset.`);
        }

        const readyTasks = subtasks.filter((t) => t.status === "PENDING" && t.is_independent);
        for (const task of readyTasks) {
          try {
            const session = await this.deps.startJulesTask(task, args.source_id, defaultFeatureBranch, args.repo_path, args.sprint_number);
            task.status = "RUNNING";
            task.session_name = this.deps.resolveSessionName(session);
            task.session_id = this.deps.extractSessionId(session);
            reportText += `🚀 **Started Jules Session** for task \`${task.id}\`: [${session.id}](${session.id})\n`;
            this.deps.setConsecutiveFailures(0);
          } catch (error: any) {
            const currentFails = this.deps.getConsecutiveFailures() + 1;
            this.deps.setConsecutiveFailures(currentFails);
            console.error(`Error starting task ${task.id}: ${error.message} (Consecutive failures: ${currentFails}/${maxFails})`);
            if (currentFails >= maxFails) {
              throw new Error(`CRITICAL: Emergency stop triggered after ${currentFails} consecutive task creation failures.`);
            }
          }
        }
      }

      const awaitingMerge = subtasks.filter((t) => t.status === "COMPLETED" && !t.is_merged);
      if (awaitingMerge.length > 0) {
        instructions += `\n### 📥 MERGE INSTRUCTIONS\n`;
        for (const task of awaitingMerge) {
          instructions += `1. **Task ${task.id}**: Merge the Jules-created branch into \`${defaultFeatureBranch}\`.\n`;
          instructions += `2. Update \`${path.join(subtasksDir, task.id + ".md")}\` with \`merged: true\`.\n`;
        }
      }

      const actionRequiredTasks = subtasks.filter((t) => t.status === "BLOCKED" && this.deps.isActionRequiredState(t.session_state));
      if (actionRequiredTasks.length > 0) {
        instructions += `\n### ✋ JULES ACTION REQUIRED\n`;
        for (const task of actionRequiredTasks) {
          instructions += `- **Task ${task.id}** is \`${task.session_state}\`. Open the Jules session and resolve the pending action, then rerun orchestration.\n`;
        }
      }

      let statusTable = `#### Task Status:\n`;
      for (const task of subtasks) {
        let statusIcon = "💤";
        if (task.status === "COMPLETED") statusIcon = task.is_merged ? "✅" : "🤝";
        else if (task.status === "RUNNING") statusIcon = "⏳";
        else if (task.status === "BLOCKED") statusIcon = "🚫";
        else if (task.status === "FAILED") statusIcon = "❌";

        const mergeInfo = task.status === "COMPLETED" && !task.is_merged ? " **(Awaiting Merge)**" : "";
        statusTable += `- ${statusIcon} **${task.id}**: \`${task.status}\`${mergeInfo} - ${task.title}\n`;
      }

      return { subtasks, reportText, statusTable, instructions };
    };

    const shouldWait = args.wait !== undefined ? args.wait : (args.action === "status" || args.action === "orchestrate");

    if (shouldWait) {
      let allFinished = false;
      let fullReport = `### Sprint ${args.sprint_number} Continuous Orchestration\n\n`;
      const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
      fullReport += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
      fullReport += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;

      console.error(`Starting watch loop for Sprint ${args.sprint_number}...`);
      console.error(`Live dashboard available at http://localhost:${dashboardPort}`);

      while (!allFinished) {
        const { subtasks, reportText, statusTable, instructions } = await runOrchestrationCycle();

        const timestamp = new Date().toLocaleTimeString();
        this.deps.updateLastStatus({
          sprint_number: args.sprint_number,
          feature_branch: defaultFeatureBranch,
          subtasks,
          reportText,
          statusTable,
          instructions,
          timestamp,
        });

        console.error(`[${timestamp}] Cycle complete. Status updated.`);
        if (reportText) console.error(reportText);

        const runningTasks = subtasks.filter((t) => t.status === "RUNNING");
        const readyTasks = subtasks.filter((t) => t.status === "PENDING" && t.is_independent);
        const awaitingMerge = subtasks.filter((t) => t.status === "COMPLETED" && !t.is_merged);

        allFinished = subtasks.length > 0 && subtasks.every((t) => (t.status === "COMPLETED" && t.is_merged) || t.status === "FAILED");
        const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0;
        const needsManualMerge = awaitingMerge.length > 0;

        if (allFinished || noMoreActionPossible || needsManualMerge) {
          allFinished = true;
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;

          if (needsManualMerge) {
            fullReport += `\n🛑 **Action Required: Merge Detected**\n`;
            fullReport += `One or more tasks have finished. Please follow the **MERGE INSTRUCTIONS** below, then run \`orchestrate\` again to continue.\n`;
          } else if (subtasks.length > 0 && !subtasks.every((t) => (t.status === "COMPLETED" && t.is_merged) || t.status === "FAILED") && noMoreActionPossible) {
            fullReport += `\n🛑 **Action Required:** Orchestration paused. No tasks are running and no pending tasks can be started.\n`;
          }

          try {
            const watchGuide = await this.deps.getGuideContent("watch.md", args.repo_path);
            fullReport += `\n---\n\n### Watch Loop Operating Standard\n\n${watchGuide}`;
          } catch {}

          if (subtasks.length > 0 && subtasks.every((t) => t.status === "COMPLETED" && t.is_merged)) {
            try {
              console.error(`Marking sprint as completed and cleaning up subtasks directory: ${subtasksDir}`);
              this.deps.completedSprints.add(args.sprint_number);
              await fs.rm(subtasksDir, { recursive: true, force: true });
              fullReport += `\n🧹 **Cleanup:** All tasks completed and merged successfully. Deleted subtasks in \`${subtasksDir}\`.\n`;
              fullReport += `\n## 🏁 SPRINT COMPLETION STEPS\n`;
              fullReport += `1. **Create Pull Request**: Merge \`${defaultFeatureBranch}\` into \`main\`.\n`;
              fullReport += `2. **Final Review**: Review all code changes implemented by Jules subagents.\n`;
              fullReport += `3. **CI/CD Verification**: Wait for all CI checks to turn green. If merge conflicts or CI errors occur, fix them locally and push until all checks pass.\n`;
              fullReport += `4. **Next Sprint**: Proceed with the implementation of Sprint ${args.sprint_number + 1} (auto-continue: true).\n`;
            } catch (cleanupError) {
              console.error(`Warning: Failed to cleanup subtasks: ${cleanupError}`);
            }
          } else if (subtasks.some((t) => t.status === "FAILED")) {
            fullReport += `\n⚠️ **Cleanup Skipped:** Some tasks failed. Subtasks in \`${subtasksDir}\` are preserved for debugging.\n`;
          } else if (subtasks.some((t) => t.status === "COMPLETED" && !t.is_merged)) {
            fullReport += `\n⏸️ **Cleanup Deferred:** Awaiting merges for completed tasks.\n`;
          } else if (subtasks.length === 0) {
            fullReport += `\n⚠️ **Sprint Empty:** No subtasks found. The sprint has not been planned yet.\n`;
          }

          fullReport += `\n✅ **Sprint Execution Finished.**\n`;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 120 * 1000));
        }
      }

      return { content: [{ type: "text", text: fullReport }] };
    }

    const { subtasks, reportText, statusTable, instructions } = await runOrchestrationCycle();
    const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
    let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
    report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
    report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;
    report += reportText;
    report += statusTable;
    report += instructions;

    try {
      const orchGuide = await this.deps.getGuideContent("orchestrator.md", args.repo_path);
      report += `\n---\n\n### Orchestration Guidance\n\n${orchGuide}`;
    } catch {}

    return { content: [{ type: "text", text: report }] };
  }
}
