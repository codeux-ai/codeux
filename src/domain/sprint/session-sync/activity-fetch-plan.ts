import { Subtask, JulesSession } from "../../../contracts/app-types.js";

import { buildTaskRunKey } from "../../../services/task-run-key.js";
import type { Logger } from "../../../shared/logging/logger.js";

/**
 * Predicate to determine if a session is locally terminal in the execution system.
 * True indicates we no longer need to fetch active activities for it.
 */
export type LocalTerminalPredicate = (sessionName: string, task: Subtask) => boolean;

export interface ActivityFetchSessionMetadata {
  sessionId: string | null;
  sessionName: string | null;
}

export interface ActivityFetchSessionMetadataLookup {
  getForSession: (session: JulesSession) => ActivityFetchSessionMetadata;
}

export function planSessionActivityFetches(
  subtasks: Subtask[],
  sessionMap: Map<string, JulesSession>,
  context: { repoPath: string; sprintNumber: number; githubMode?: "LOCAL" | "REMOTE" },
  sessionMetadataLookup: ActivityFetchSessionMetadataLookup,
  logger: Logger,
  isForeignSessionMatch: (task: Subtask, session: JulesSession) => boolean,
  isLocallyTerminal?: LocalTerminalPredicate
): string[] {
  const uniqueSessionNames = new Set<string>();

  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);

    if (match) {
      const sessionMetadata = sessionMetadataLookup.getForSession(match);
      if (isForeignSessionMatch(task, match)) {
        logger.warn("Skipping foreign provider session matched by task run key", {
          taskId: task.record_id || task.id,
          projectId: task.project_id,
          sprintId: task.sprint_id,
          sessionId: sessionMetadata.sessionId,
          sessionName: sessionMetadata.sessionName,
        });
        continue;
      }

      const sessionName = sessionMetadata.sessionName;
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
