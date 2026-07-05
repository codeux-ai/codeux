import type { FunctionComponent } from "preact";
import { useMemo, useRef, useState, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { GitBranch, ListTodo, Rows3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { GitTelemetryTab } from "./GitTelemetryTab.js";
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  TAB_ACTIVE_CLASS,
  TAB_COUNT_ACTIVE_CLASS,
  TAB_COUNT_IDLE_CLASS,
  TAB_IDLE_CLASS,
  TEXT_DETAIL_CLASS,
} from "./StatsShared.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

export interface TelemetryLedgerTabsProps {
  stats: ProjectExecutionStatsSnapshot;
}

type LedgerTab = "tasks" | "sprints" | "git";

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

export const TelemetryLedgerTabs: FunctionComponent<TelemetryLedgerTabsProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<LedgerTab>("tasks");
  const contentRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<LedgerTab, HTMLButtonElement | null>>({
    tasks: null,
    sprints: null,
    git: null,
  });
  const reducedMotion = useReducedMotion();
  const prevTab = useRef(activeTab);

  const tabs = useMemo(() => {
    const taskCount = stats.tasks.length;
    const sprintCount = stats.sprints.length;
    const gitStats = stats.git ?? null;
    const gitCount = gitStats ? gitStats.tasks.length + gitStats.sprints.length : 0;

    return [
      { id: "tasks" as const, label: "Task Telemetry", detail: "Provider work lanes", icon: ListTodo, count: taskCount },
      { id: "sprints" as const, label: "Sprint Telemetry", detail: "Sprint rollups", icon: Rows3, count: sprintCount },
      ...(gitStats ? [{ id: "git" as const, label: "Git Telemetry", detail: "PR and churn lanes", icon: GitBranch, count: gitCount }] : []),
    ];
  }, [stats]);

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

  const focusTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    setActiveTab(tab.id);
    tabRefs.current[tab.id]?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label="Telemetry ledgers"
        className="sticky top-3 z-20 grid w-full max-w-full min-w-0 grid-cols-1 gap-1 rounded-[var(--stats-subpanel-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-subpanel)] p-1 shadow-[var(--stats-subpanel-shadow)] backdrop-blur-xl sm:grid-cols-2 xl:grid-cols-3"
        onKeyDown={(e) => {
          if (tabs.length === 0) {
            return;
          }

          if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            const focusedIndex = tabs.findIndex((tab) => tabRefs.current[tab.id] === document.activeElement);
            const currentIndex = focusedIndex >= 0 ? focusedIndex : tabs.findIndex(t => t.id === activeTab);
            let nextIndex = currentIndex;
            if (e.key === "Home") {
              nextIndex = 0;
            } else if (e.key === "End") {
              nextIndex = tabs.length - 1;
            } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              nextIndex = currentIndex + 1;
            } else {
              nextIndex = currentIndex - 1;
            }
            if (nextIndex >= tabs.length) nextIndex = 0;
            if (nextIndex < 0) nextIndex = tabs.length - 1;
            focusTab(nextIndex);
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
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              aria-label={`${tab.label}, ${tab.count.toLocaleString()} ${tab.count === 1 ? "entry" : "entries"}`}
              className={`grid min-h-16 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[calc(var(--stats-subpanel-radius)-0.35rem)] px-3 py-2 text-left transition-[background-color,border-color,box-shadow,color] motion-safe:duration-200 motion-reduce:transition-none ${CONTROL_FOCUS_CLASS} ${
                isActive ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.14em]">{tab.label}</span>
                <span className={`mt-0.5 block truncate text-[10px] font-bold normal-case tracking-normal ${
                  isActive ? TEXT_DETAIL_CLASS : TEXT_DETAIL_CLASS
                }`}>
                  {tab.detail}
                </span>
              </span>
              <span className={`inline-flex min-w-10 justify-center rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums tracking-wider ${CHIP_CLASS} ${
                  isActive ? TAB_COUNT_ACTIVE_CLASS : TAB_COUNT_IDLE_CLASS
              }`}>
                {formatCompactCount(tab.count)}
              </span>
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
        className="min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--stats-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--stats-focus-ring-offset)]"
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
