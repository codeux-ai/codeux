import type { FunctionComponent } from "preact";
import { useState, useRef, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { GitBranch, ListTodo, Rows3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { GitTelemetryTab } from "./GitTelemetryTab.js";
import { CHIP_CLASS } from "./StatsShared.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

export interface TelemetryLedgerTabsProps {
  stats: ProjectExecutionStatsSnapshot;
}

type LedgerTab = "tasks" | "sprints" | "git";

export const TelemetryLedgerTabs: FunctionComponent<TelemetryLedgerTabsProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<LedgerTab>("tasks");
  const contentRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const prevTab = useRef(activeTab);

  useLayoutEffect(() => {
    if (!contentRef.current || prevTab.current === activeTab) return;

    if (reducedMotion) {
      prevTab.current = activeTab;
      return;
    }

    gsap.killTweensOf(contentRef.current);
    gsap.fromTo(
      contentRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", clearProps: "all" }
    );
    prevTab.current = activeTab;
  }, [activeTab, reducedMotion]);

  const tabs: Array<{ id: LedgerTab; label: string; icon: typeof ListTodo; badge: string | null }> = [
    { id: "tasks", label: "Task Telemetry", icon: ListTodo, badge: `${stats.tasks.length} tasks` },
    { id: "sprints", label: "Sprint Telemetry", icon: Rows3, badge: `${stats.sprints.length} sprints` },
    ...(stats.git ? [{ id: "git" as const, label: "Git Telemetry", icon: GitBranch, badge: null }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Telemetry ledgers"
        className="flex max-w-full gap-1 self-start overflow-x-auto rounded-2xl border border-[var(--stats-card-border)] bg-[var(--stats-chip-bg)] p-1 shadow-[var(--stats-card-shadow)]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const currentIndex = tabs.findIndex(t => t.id === activeTab);
            let nextIndex = e.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
            if (nextIndex >= tabs.length) nextIndex = 0;
            if (nextIndex < 0) nextIndex = tabs.length - 1;
            setActiveTab(tabs[nextIndex].id);
            // Delay the focus by a microtask to allow render to complete
            Promise.resolve().then(() => {
              document.getElementById(`tab-${tabs[nextIndex].id}`)?.focus();
            });
          }
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 ${
                isActive
                  ? "bg-amber-500 text-white shadow-[var(--stats-card-shadow)]"
                  : "text-[var(--stats-detail-color)] hover:bg-[var(--stats-row-hover-bg)] hover:text-[var(--stats-value-color)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {tab.label}
              {tab.badge !== null ? (
                <span className={`px-2 py-0.5 text-[9px] font-black tracking-wider ${CHIP_CLASS} ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-[var(--stats-detail-color)]"
                }`}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        ref={contentRef}
      >
        {activeTab === "git" && stats.git ? (
          <GitTelemetryTab gitStats={stats.git} />
        ) : activeTab === "sprints" ? (
          <TelemetryLedger
            title="Sprint Telemetry"
            eyebrow="Sprint Ledger"
            items={stats.sprints}
            kindLabel="sprints"
            emptyLabel="No sprint telemetry active in this window."
          />
        ) : (
          <TelemetryLedger
            title="Task Telemetry"
            eyebrow="Task Ledger"
            items={stats.tasks}
            kindLabel="tasks"
            emptyLabel="No task telemetry landed in this window yet."
          />
        )}
      </div>
    </div>
  );
};
