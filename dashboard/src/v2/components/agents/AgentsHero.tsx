import type { ComponentChildren, FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, FileDown, FileUp, Loader2, Plus, Sparkles } from "lucide-preact";

import type { Source, AgentPreset } from "../../types.js";
import { PageHeader } from "../layout/PageHeader.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { agentsMessages } from "../../i18n/messages/agents.js";

export const AgentsHero: FunctionComponent<{
  selectedProject: Source | null;
  projectLoading?: boolean;
  loading?: boolean;
  presets?: AgentPreset[];
  onCreate: () => void;
  onPullFromFiles: () => void;
  onPushToFiles: () => void;
  extraActions?: ComponentChildren;
  pullingFromFiles: boolean;
  pushingToFiles: boolean;
  fileSyncDisabled?: boolean;
}> = ({
  selectedProject,
  presets,
  onCreate,
  onPullFromFiles,
  onPushToFiles,
  extraActions,
  pullingFromFiles,
  pushingToFiles,
  fileSyncDisabled = false,
}) => {
  const { formatNumber, translate } = useDashboardI18n();
  const heroRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!heroRef.current) return;
    gsap.fromTo(
      Array.from(heroRef.current.querySelectorAll("[data-hero-anim]")),
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.85, stagger: 0.09, ease: "power4.out" }
    );
  }, []);

  const total = presets?.length ?? 0;
  const synced = (presets ?? []).filter((p) => p.syncStatus === "synced").length;
  const fileActionsDisabled = !selectedProject || fileSyncDisabled;

  return (
    <div ref={heroRef} className="relative flex flex-col gap-5">
      <PageHeader
        data-hero-anim
        icon={Sparkles}
        eyebrow={translate(agentsMessages, "agentWorkshop")}
        title={translate(agentsMessages, "yourWorkforce")}
        subtitle={translate(agentsMessages, "heroSubtitle")}
        actions={
          <>
            <button
              type="button"
              onClick={onPullFromFiles}
              disabled={fileActionsDisabled || pullingFromFiles}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 backdrop-blur-md transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white disabled:dark:hover:bg-white/[0.03] disabled:dark:hover:text-slate-300"
            >
              {pullingFromFiles ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.3} />
              ) : (
                <FileDown className="h-3.5 w-3.5" strokeWidth={2.3} />
              )}
              {translate(agentsMessages, "pullFromFiles")}
            </button>
            <button
              type="button"
              onClick={onPushToFiles}
              disabled={fileActionsDisabled || pushingToFiles}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 backdrop-blur-md transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white disabled:dark:hover:bg-white/[0.03] disabled:dark:hover:text-slate-300"
            >
              {pushingToFiles ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.3} />
              ) : (
                <FileUp className="h-3.5 w-3.5" strokeWidth={2.3} />
              )}
              {translate(agentsMessages, "pushToFiles")}
            </button>
            {extraActions}
            <button
              type="button"
              onClick={onCreate}
              disabled={!selectedProject}
              className="group/btn inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white dark:text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <Plus className="h-3.5 w-3.5 transition-transform group-hover/btn:rotate-90" strokeWidth={2.5} />
              {translate(agentsMessages, "newAgent")}
            </button>
          </>
        }
      />

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-hero-anim>
          <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/30 bg-signal-500/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 shadow-sm dark:border-signal-500/25 dark:bg-signal-500/15 dark:text-signal-400">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-signal-500 font-mono text-[9px] font-black text-white dark:text-void-900">
              {formatNumber(total)}
            </span>
            {translate(agentsMessages, "active")}
          </span>
          {synced > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]" />
              {translate(agentsMessages, "syncedCount", { count: formatNumber(synced) })}
            </span>
          )}
          {selectedProject && (
            <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
              <Bot className="h-3 w-3" strokeWidth={2.4} />
              <span className="max-w-[10rem] truncate">{selectedProject.name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
