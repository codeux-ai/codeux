import { vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { Subtask } from "../../../src/contracts/app-types.js";

export const buildDeps = () => {
  const listSessions = vi.fn().mockResolvedValue({ sessions: [] });
  const getGuideContent = vi.fn().mockResolvedValue("guide");
  const subtaskRepository = {
    loadSubtasks: vi.fn<() => Promise<Subtask[]>>().mockResolvedValue([]),
    setMerged: vi.fn(async (dir: string, taskId: string, merged: boolean) => {
      const filePath = path.join(dir, `${taskId}.md`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const mergedValue = merged ? "true" : "false";
        let updated = content;
        if (/^\s*merged:\s*(true|false)\s*$/m.test(content)) {
          updated = content.replace(/^\s*merged:\s*(true|false)\s*$/m, `merged: ${mergedValue}`);
        } else if (/^\s*prompt:\s*/m.test(content)) {
          updated = content.replace(/^\s*prompt:\s*/m, `merged: ${mergedValue}\nprompt:`);
        } else {
          updated = `${content.trimEnd()}\nmerged: ${mergedValue}\n`;
        }
        await fs.writeFile(filePath, updated, "utf-8");
      } catch {
        // Mock ignore
      }
    }),
    loadSubtask: vi.fn(),
  };

  const deps: any = {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => ({ ...DEFAULT_DASHBOARD_SETTINGS }),
    renderInstruction: vi.fn(async (templateId: string, variables: Record<string, unknown>) => {
      if (templateId === "planningMissing" && typeof variables.subtasks_dir === "string") {
        return `### 🛑 ACTION REQUIRED: Sprint Planning Missing\n\nNo subtasks found in \`${variables.subtasks_dir}\`.`;
      }
      if (templateId === "branchMissing" && typeof variables.feature_branch === "string") {
        return `### 🛑 ACTION REQUIRED: Branch Configuration Missing\n\nThe feature branch \`${variables.feature_branch}\` is not ready.`;
      }
      if (templateId === "actionRequiredAgentHeader") {
        return "\n### 🤖 AGENT INTERVENTION NEEDED\n";
      }
      if (templateId === "actionRequiredAgentTask" || templateId === "actionRequiredHumanTask") {
        return `- **Task ${variables.task_id}** is \`${variables.session_state}\`.`;
      }
      if (templateId === "actionRequiredHumanHeader") {
        return "\n### ✋ HUMAN INTERVENTION NEEDED\n";
      }
      if (templateId === "watchHeader") {
        return "### Sprint Header";
      }
      return "";
    }),
    isJulesApiConfigured: () => true,
    loadSubtasks: vi.fn().mockResolvedValue([]),
    updateLastStatus: vi.fn(),
    completedSprints: new Set<number>(),
    getCiStatusForScope: vi.fn().mockResolvedValue(null),
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    fetchRecentActivities: vi.fn().mockResolvedValue([]),
    listSessions,
    subtaskRepository,
    startTask: vi.fn(),
    getGuideContent,
    approveSessionPlan: vi.fn().mockResolvedValue({}),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  };

  return { deps, listSessions, subtaskRepository, getGuideContent };
};
