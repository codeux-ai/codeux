import { Subtask, JulesSession } from "../../../contracts/app-types.js";

import { buildTaskRunKey } from "../../../services/task-run-key.js";
import { SessionSyncDependencies } from "../../../sprint/sprint-types.js";

/**
 * Predicate to determine if a session is locally terminal in the execution system.
 * True indicates we no longer need to fetch active activities for it.
 */
export type LocalTerminalPredicate = (sessionName: string, task: Subtask) => boolean;

export function planSessionActivityFetches(
  subtasks: Subtask[],
  sessionMap: Map<string, JulesSession>,
  context: { repoPath: string; sprintNumber: number; githubMode?: "LOCAL" | "REMOTE" },
  deps: Pick<SessionSyncDependencies, "resolveSessionName" | "extractSessionId" | "logger">,
  isForeignSessionMatch: (deps: any, task: Subtask, session: JulesSession) => boolean,
  isLocallyTerminal?: LocalTerminalPredicate
): string[] {
  const uniqueSessionNames = new Set<string>();

  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);

    if (match) {
      if (isForeignSessionMatch(deps as any, task, match)) {
        deps.logger.warn("Skipping foreign provider session matched by task run key", {
          taskId: task.record_id || task.id,
          projectId: task.project_id,
          sprintId: task.sprint_id,
          sessionId: deps.extractSessionId(match),
          sessionName: deps.resolveSessionName(match),
        });
        continue;
      }

      const sessionName = deps.resolveSessionName(match);
      if (sessionName) {
        let isFullySynced = false;

        if (isLocallyTerminal && isLocallyTerminal(sessionName, task)) {
            isFullySynced = true;
        }

        const isRemoteTerminal = match.state === "COMPLETED" || match.state === "FAILED";
        if (isFullySynced && isRemoteTerminal) {
          continue;
        }

        uniqueSessionNames.add(sessionName);
      }
    }
  }

  return Array.from(uniqueSessionNames);
}
