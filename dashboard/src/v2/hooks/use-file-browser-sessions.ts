import { useEffect, useMemo, useState } from "preact/hooks";
import type { FileBrowserSession } from "../../types.js";
import { fetchFileBrowserSessions } from "../lib/file-browser-api.js";

interface UseFileBrowserSessionsOptions {
  projectId: string | null;
  selectedSprintId?: string | null;
  activeSessionId?: string | null;
  pollInterval?: number;
}

interface UseFileBrowserSessionsResult {
  sessions: FileBrowserSession[];
  selectedSession: FileBrowserSession | null;
  loading: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
}

export const useFileBrowserSessions = ({
  projectId,
  selectedSprintId,
  activeSessionId,
  pollInterval = 8000,
}: UseFileBrowserSessionsOptions): UseFileBrowserSessionsResult => {
  const [sessions, setSessions] = useState<FileBrowserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (silent = false): Promise<void> => {
    if (!projectId) {
      setSessions([]);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await fetchFileBrowserSessions(projectId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !pollInterval) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, pollInterval);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pollInterval]);

  const selectedSession = useMemo(() => {
    if (activeSessionId) {
      return sessions.find((session) => session.id === activeSessionId) || null;
    }
    if (selectedSprintId) {
      return sessions.find((session) => session.sprintId === selectedSprintId) || null;
    }
    return sessions[0] || null;
  }, [activeSessionId, selectedSprintId, sessions]);

  return { sessions, selectedSession, loading, error, refresh };
};
