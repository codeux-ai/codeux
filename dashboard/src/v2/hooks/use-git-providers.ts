import { useState, useEffect } from "preact/hooks";
import { fetchAvailableGitProviders, type AvailableGitProviders } from "../lib/project-api.js";

export function useGitProviders(): AvailableGitProviders {
  const [providers, setProviders] = useState<AvailableGitProviders>({ github: false, gitlab: false });
  useEffect(() => {
    fetchAvailableGitProviders().then(setProviders).catch(() => {});
  }, []);
  return providers;
}
