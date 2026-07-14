import type { FunctionComponent } from "preact";
import { Plus } from "lucide-preact";
import { useDashboardI18n } from "../../i18n/context.js";
import { projectMessages } from "../../i18n/messages/projects.js";

export interface AddProjectCardProps {
  onClick: () => void;
}

export const AddProjectCard: FunctionComponent<AddProjectCardProps> = ({ onClick }) => {
  const { translate } = useDashboardI18n();

  return (
    <button
    type="button"
    aria-label={translate(projectMessages, "addProject")}
    onClick={onClick}
    className="group flex h-full min-h-[390px] w-full min-w-0 flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-dashed border-black/[0.12] bg-white/55 p-5 text-center shadow-sm backdrop-blur-xl motion-safe:transition-colors motion-safe:duration-150 hover:border-signal-500/45 hover:bg-signal-500/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.12] dark:bg-void-800/50 dark:focus-visible:ring-offset-void-900"
  >
    <span className="grid h-12 w-12 place-items-center rounded-2xl border border-black/[0.08] bg-white/60 text-slate-500 motion-safe:transition-colors motion-safe:duration-150 group-hover:border-signal-500/30 group-hover:text-signal-600 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-slate-400 dark:group-hover:text-signal-300">
      <Plus className="h-5 w-5" aria-hidden="true" />
    </span>
    <span className="font-display text-base font-semibold text-slate-800 dark:text-slate-100">{translate(projectMessages, "addProject")}</span>
    <span className="max-w-48 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      {translate(projectMessages, "connectProjectDescription")}
    </span>
    </button>
  );
};
