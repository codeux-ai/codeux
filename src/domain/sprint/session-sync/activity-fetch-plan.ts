import { Subtask, JulesSession } from "../../../contracts/app-types.js";

import { mapSessionStateToTaskRunState } from "./session-state-mapping.js";
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

const normalizeSessionRef = (sessionRef: string | null | undefined): string | null => {
  if (typeof sessionRef !== "string") {
    return null;
  }
  const normalized = sessionRef.trim().replace(/^sessions\//, "");
  return normalized.length > 0 ? normalized : null;
};

const isRemoteTerminalSession = (session: JulesSession): boolean => {
  const mappedState = mapSessionStateToTaskRunState(session.state, () => false);
  return mappedState === "COMPLETED" || mappedState === "FAILED";
};

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
  const metadataBySessionObject = new WeakMap<JulesSession, ActivityFetchSessionMetadata>();
  const metadataByAlias = new Map<string, ActivityFetchSessionMetadata>();

  const cacheMetadataAliases = (metadata: ActivityFetchSessionMetadata): ActivityFetchSessionMetadata => {
    for (const alias of [metadata.sessionId, metadata.sessionName]) {
      const normalizedAlias = normalizeSessionRef(alias);
      if (normalizedAlias) {
        metadataByAlias.set(normalizedAlias, metadata);
      }
    }
    return metadata;
  };

  const getSessionMetadata = (session: JulesSession): ActivityFetchSessionMetadata => {
    const cachedByObject = metadataBySessionObject.get(session);
    if (cachedByObject) {
      return cachedByObject;
    }

    for (const alias of [session.id, session.name]) {
      const normalizedAlias = normalizeSessionRef(alias);
      const cachedByAlias = normalizedAlias ? metadataByAlias.get(normalizedAlias) : undefined;
      if (cachedByAlias) {
        metadataBySessionObject.set(session, cachedByAlias);
        return cachedByAlias;
      }
    }

    const metadata = cacheMetadataAliases(sessionMetadataLookup.getForSession(session));
    metadataBySessionObject.set(session, metadata);
    return metadata;
  };

  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);
    if (!match) {
      continue;
    }

    const sessionMetadata = getSessionMetadata(match);
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
    if (!sessionName) {
      continue;
    }

    const isLocalTerminal = isLocallyTerminal?.(sessionName, task) ?? false;
    const isRemoteTerminal = isRemoteTerminalSession(match);
    if (isLocalTerminal && isRemoteTerminal) {
      logger.debug?.("Skipping activity fetch for fully synchronized terminal session", {
        taskId: task.record_id || task.id,
        projectId: task.project_id,
        sprintId: task.sprint_id,
        sessionId: sessionMetadata.sessionId,
        sessionName,
        sessionState: match.state || null,
      });
      continue;
    }

    uniqueSessionNames.add(sessionName);
  }

  return Array.from(uniqueSessionNames);
}
