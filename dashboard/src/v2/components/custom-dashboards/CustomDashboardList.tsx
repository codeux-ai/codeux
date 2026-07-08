import type { FunctionComponent } from "preact";
import { LayoutDashboard, Plus } from "lucide-preact";
import { Button } from "../ui/Button.js";
import type { CustomDashboardRecord } from "../../types.js";
import { getDashboardStatusView } from "../../lib/custom-dashboard-view-models.js";

interface CustomDashboardListProps {
  dashboards: CustomDashboardRecord[];
  selectedDashboardId: string | null;
  onSelect: (dashboardId: string) => void;
  onCreate: () => void;
  creating: boolean;
}

export const CustomDashboardList: FunctionComponent<CustomDashboardListProps> = ({
  dashboards,
  selectedDashboardId,
  onSelect,
  onCreate,
  creating,
}) => (
  <section
    aria-label="Custom dashboards"
    className="flex min-h-[18rem] flex-col rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-3 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]"
  >
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">Dashboards</h2>
      <Button size="sm" variant="signal" icon={Plus} pending={creating} onClick={onCreate}>
        New
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {dashboards.map((dashboard) => {
        const status = getDashboardStatusView(dashboard.status);
        const active = dashboard.id === selectedDashboardId;
        return (
          <button
            key={dashboard.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(dashboard.id)}
            className={`group flex min-h-[5rem] w-full min-w-0 flex-col items-start gap-2 rounded-[1rem] border p-3 text-left transition-[background-color,border-color,box-shadow,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 ${
              active
                ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[inset_0_0_0_1px_rgba(0,224,160,0.14)]"
                : "border-black/[0.06] bg-white/45 hover:border-black/[0.12] hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/[0.14]"
            }`}
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <LayoutDashboard aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-500" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-white">
                {dashboard.title}
              </span>
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${status.className}`}>
              {status.label}
            </span>
            {dashboard.description ? (
              <span className="line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {dashboard.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  </section>
);
