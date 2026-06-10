import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { GitBranch, ListTodo, Rows3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { GitTelemetryTab } from "./GitTelemetryTab.js";

export interface TelemetryLedgerTabsProps {
  stats: ProjectExecutionStatsSnapshot;
}

type LedgerTab = "tasks" | "sprints" | "git";

export const TelemetryLedgerTabs: FunctionComponent<TelemetryLedgerTabsProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<LedgerTab>("tasks");

  const tabs: Array<{ id: LedgerTab; label: string; icon: typeof ListTodo; count: number | null }> = [
    { id: "tasks", label: "Task Telemetry", icon: ListTodo, count: stats.tasks.length },
    { id: "sprints", label: "Sprint Telemetry", icon: Rows3, count: stats.sprints.length },
    ...(stats.git ? [{ id: "git" as const, label: "Git Telemetry", icon: GitBranch, count: null }] : []),
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
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-all ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {tab.label}
              {tab.count !== null ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                  isActive
                    ? "bg-white/20 text-white dark:bg-void-900/15 dark:text-void-900"
                    : "bg-black/[0.05] text-slate-500 dark:bg-white/[0.08] dark:text-slate-400"
                }`}>
                  {tab.count}
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
