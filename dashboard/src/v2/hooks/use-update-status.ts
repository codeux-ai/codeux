import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchUpdateStatus, type UpdateStatus } from "../lib/system-api.js";

export interface UseUpdateStatusResult {
  status: UpdateStatus | null;
  updateAvailable: boolean;
  latestVersion: string | null;
}

export function useUpdateStatus(): UseUpdateStatusResult {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchUpdateStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const updateAvailable = status?.updateAvailable === true;
  const latestVersion = status?.latestVersion ?? null;

  return useMemo(
    () => ({ status, updateAvailable, latestVersion }),
    [status, updateAvailable, latestVersion],
  );
}
