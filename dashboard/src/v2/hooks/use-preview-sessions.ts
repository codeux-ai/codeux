import { useEffect, useState, useMemo } from "preact/hooks";
import type { SprintPreviewSession } from "../../types.js";
import { fetchPreviewSessions } from "../lib/browser-api.js";

interface UsePreviewSessionsOptions {
  projectId: string | null;
  selectedSprintId?: string | null;
  activeSessionId?: string | null;
  pollInterval?: number;
}

interface UsePreviewSessionsResult {
  sessions: SprintPreviewSession[];
  selectedSession: SprintPreviewSession | null;
  loading: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
}

export const usePreviewSessions = ({
  projectId,
  selectedSprintId,
  activeSessionId,
  pollInterval = 8000,
}: UsePreviewSessionsOptions): UsePreviewSessionsResult => {
  const [sessions, setSessions] = useState<SprintPreviewSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (silent = false): Promise<void> => {
    if (!projectId) {
      setSessions([]);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await fetchPreviewSessions(projectId);
      setSessions(data);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !pollInterval) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, pollInterval);
    return () => window.clearInterval(timer);
  }, [projectId, pollInterval]);

  const selectedSession = useMemo(() => {
    if (activeSessionId) {
      return (sessions ?? []).find((session) => session.id === activeSessionId) || null;
    }
    if (selectedSprintId) {
      return (sessions ?? []).find((session) => session.sprintId === selectedSprintId) || null;
    }
    return sessions[0] || null;
  }, [activeSessionId, selectedSprintId, sessions]);

  return { sessions, selectedSession, loading, error, refresh };
};
