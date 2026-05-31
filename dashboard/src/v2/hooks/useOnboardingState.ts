import { useCallback, useEffect, useState } from "preact/hooks";
import { fetchJson } from "../../lib/api/fetch-json.js";
import type { UserOnboardingState } from "../../types.js";

const DEFAULT_ONBOARDING_STATE: UserOnboardingState = {
  completed: false,
  onboardingCompletedAt: null,
};

export const useOnboardingState = () => {
  const [state, setState] = useState<UserOnboardingState>(DEFAULT_ONBOARDING_STATE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextState = await fetchJson<UserOnboardingState>("/api/user/onboarding");
      setState(nextState);
    } catch {
      setState(DEFAULT_ONBOARDING_STATE);
    } finally {
      setLoading(false);
    }
  }, []);

  const markCompleted = useCallback(async (action: "complete" | "cancel") => {
    const nextState = await fetchJson<UserOnboardingState>(`/api/user/onboarding/${action}`, {
      method: "POST",
    });
    setState(nextState);
    return nextState;
  }, []);

  const reset = useCallback(async () => {
    const nextState = await fetchJson<UserOnboardingState>("/api/user/onboarding/reset", {
      method: "POST",
    });
    setState(nextState);
    return nextState;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    state,
    loading,
    refresh,
    markCompleted,
    reset,
  };
};
