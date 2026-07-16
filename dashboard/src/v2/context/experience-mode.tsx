import type { ComponentChildren, FunctionComponent } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { DashboardExperienceMode } from "../../types.js";

interface DashboardExperienceModeContextValue {
  mode: DashboardExperienceMode | null;
}

const DashboardExperienceModeContext = createContext<DashboardExperienceModeContextValue | undefined>(undefined);

export const DashboardExperienceModeProvider: FunctionComponent<{
  mode: DashboardExperienceMode | null;
  children: ComponentChildren;
}> = ({ mode, children }) => (
  <DashboardExperienceModeContext.Provider value={{ mode }}>
    {children}
  </DashboardExperienceModeContext.Provider>
);

export function useDashboardExperienceMode(): DashboardExperienceMode | null | undefined {
  return useContext(DashboardExperienceModeContext)?.mode;
}
