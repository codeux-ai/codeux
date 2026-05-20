import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { GitTelemetryTab } from "./GitTelemetryTab.js";
import { PANEL_CLASS } from "./StatsShared.js";

export interface TelemetryLedgerTabsProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetryLedgerTabs: FunctionComponent<TelemetryLedgerTabsProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<"tasks" | "sprints" | "git">("tasks");

  return (
    <div className={`${PANEL_CLASS} flex flex-col`}>
      <div className="flex items-center gap-4 border-b border-black/[0.08] px-6 py-4 dark:border-white/[0.08]">
        <button
          type="button"
          onClick={() => setActiveTab("tasks")}
          className={`px-4 py-2 text-sm font-bold transition-colors ${
            activeTab === "tasks"
              ? "text-slate-900 dark:text-white"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
        >
          Task Telemetry
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sprints")}
          className={`px-4 py-2 text-sm font-bold transition-colors ${
            activeTab === "sprints"
              ? "text-slate-900 dark:text-white"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
        >
          Sprint Telemetry
        </button>
        {stats.git ? (
          <button
            type="button"
            onClick={() => setActiveTab("git")}
            className={`px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === "git"
                ? "text-slate-900 dark:text-white"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            Git Telemetry
          </button>
        ) : null}
      </div>

      <div className="flex-1 p-6">
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
