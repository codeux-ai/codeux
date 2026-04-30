import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";

export const ProviderPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
}> = () => (
  <div className="rounded-[1.5rem] border border-black/[0.06] bg-white/72 px-5 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
    Provider routing moved to the v2 `AI Models` panel.
  </div>
);
