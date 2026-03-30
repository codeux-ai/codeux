import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { TelemetryLedger } from "./TelemetryLedger.js";
import { PANEL_CLASS } from "./StatsShared.js";

export const TelemetryLedgerTabs: FunctionComponent<any> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<"tasks" | "sprints">("tasks");

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
      </div>

      <div className="flex-1 p-6">
        {activeTab === "tasks" ? (
          <TelemetryLedger
            title="Task Telemetry"
            eyebrow="Task Ledger"
            items={stats.tasks}
            kindLabel="tasks"
            emptyLabel="No task telemetry landed in this window yet."
          />
        ) : (
          <TelemetryLedger
            title="Sprint Telemetry"
            eyebrow="Sprint Ledger"
            items={stats.sprints}
            kindLabel="sprints"
            emptyLabel="No sprint telemetry active in this window."
          />
        )}
      </div>
    </div>
  );
};
