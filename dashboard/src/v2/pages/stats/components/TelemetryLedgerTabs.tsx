import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { GitBranch, ListTodo, Rows3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { GitTelemetryTab } from "./GitTelemetryTab.js";
import { CHIP_CLASS } from "./StatsShared.js";

export interface TelemetryLedgerTabsProps {
  stats: ProjectExecutionStatsSnapshot;
}

type LedgerTab = "tasks" | "sprints" | "git";

export const TelemetryLedgerTabs: FunctionComponent<TelemetryLedgerTabsProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<LedgerTab>("tasks");

  const tabs: Array<{ id: LedgerTab; label: string; icon: typeof ListTodo; badge: string | null }> = [
    { id: "tasks", label: "Task Telemetry", icon: ListTodo, badge: `${stats.tasks.length} tasks` },
    { id: "sprints", label: "Sprint Telemetry", icon: Rows3, badge: `${stats.sprints.length} sprints` },
    ...(stats.git ? [{ id: "git" as const, label: "Git Telemetry", icon: GitBranch, badge: null }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 self-start rounded-2xl border border-black/[0.05] bg-white/68 p-1 dark:border-white/[0.05] dark:bg-void-900/35">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {tab.label}
              {tab.badge !== null ? (
                <span className={`px-2 py-0.5 text-[9px] font-black tracking-wider ${CHIP_CLASS} ${
                  isActive
                    ? "bg-white/20 text-white dark:bg-void-900/15 dark:text-void-900"
                    : "text-slate-500 dark:text-slate-400"
                }`}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

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
  );
};
