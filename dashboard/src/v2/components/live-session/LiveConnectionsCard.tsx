import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { Bot, Radio, Server, Wifi } from "lucide-preact";
import { formatTime } from "../../../lib/time.js";
import type { ExecutionDashboardSnapshot } from "../../../types.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { WaveFluid } from "../ui/WaveFluid.js";

const CONNECTION_ROLE_LABELS: Record<string, string> = {
  listener: "Listener",
  worker: "Worker",
  project_manager: "Manager",
};

const statusTone = (value: string | null): string => {
  if (!value) return "text-slate-400";
  const normalized = value.toUpperCase();
  if (normalized === "SUCCESS" || normalized === "COMPLETED" || normalized === "MERGED") return "text-status-green";
  if (normalized === "CANCEL_REQUESTED") return "text-status-amber";
  if (normalized === "IN_PROGRESS" || normalized === "QUEUED" || normalized === "PENDING" || normalized === "QUOTA") return "text-status-amber";
  if (normalized === "FAILURE" || normalized === "FAILED" || normalized === "ERROR" || normalized === "CANCELLED") return "text-status-red";
  if (normalized === "LISTENING") return "text-signal-500";
  if (normalized === "ONLINE") return "text-status-green";
  return "text-slate-400";
};

export const LiveConnectionsCard: FunctionComponent<{
  snapshot: ExecutionDashboardSnapshot;
}> = memo(({ snapshot }) => {
  const { activeConnections, listeningConnections, workerConnections, pendingInboxTotal } = useMemo(() => {
    const active = snapshot.connections.filter((connection) => connection.status !== "offline");
    return {
      activeConnections: active,
      listeningConnections: active.filter((connection) => connection.status === "listening"),
      workerConnections: active.filter((connection) => connection.role === "worker"),
      pendingInboxTotal: snapshot.connections.reduce((sum, connection) => sum + connection.pendingInboxCount, 0),
    };
  }, [snapshot.connections, snapshot.connections.length]);

  return (
    <aside className="group relative overflow-hidden rounded-[1.4rem] border border-black/[0.06] bg-white/75 p-4 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/65 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <WaveFluid accentHex="#00E0A0" isActive={activeConnections.length > 0} />
      <BorderTrace accentHex="#00E0A0" />

      <div className="relative z-10">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">Live Connections</span>
          </div>
          <span className="rounded-full border border-black/[0.06] bg-black/[0.02] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-slate-400">
            {snapshot.connections.length} total
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {[
            { icon: <Wifi className="h-3 w-3" strokeWidth={2} />, label: "Active", value: activeConnections.length, tone: "text-signal-500" },
            { icon: <Radio className="h-3 w-3" strokeWidth={2} />, label: "Listening", value: listeningConnections.length, tone: "text-status-green" },
            { icon: <Bot className="h-3 w-3" strokeWidth={2} />, label: "Workers", value: workerConnections.length, tone: "text-slate-700 dark:text-slate-200" },
            { icon: <Server className="h-3 w-3" strokeWidth={2} />, label: "Inbox", value: pendingInboxTotal, tone: "text-status-amber" },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-black/[0.04] bg-black/[0.02] px-2.5 py-2 dark:border-white/[0.05] dark:bg-white/[0.02]">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{tile.label}</span>
                <span className="text-slate-400">{tile.icon}</span>
              </div>
              <div className={`mt-1 text-lg font-black leading-none ${tile.tone}`}>{tile.value}</div>
            </div>
          ))}
        </div>

        {snapshot.connections.length === 0 ? (
          <p className="rounded-lg border border-black/[0.04] bg-black/[0.015] px-3 py-2.5 text-[11px] font-mono text-slate-400 dark:border-white/[0.05] dark:bg-white/[0.015] dark:text-slate-600">
            No listeners or workers are connected to the selected project yet.
          </p>
        ) : (
          <div className="dashboard-scrollbar max-h-[30rem] space-y-2 overflow-y-auto pr-1">
            {snapshot.connections.map((connection) => (
              <section
                key={connection.id}
                className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 dark:border-white/[0.05] dark:bg-white/[0.015]"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{connection.displayName}</span>
                      <span className="rounded-full border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.07] dark:text-slate-400">
                        {CONNECTION_ROLE_LABELS[connection.role] || connection.role}
                      </span>
                      {connection.listenMode && (
                        <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">
                          Listening
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                      <span>{connection.transport}</span>
                      {connection.model ? <span>· {connection.model}</span> : null}
                      <span className="truncate">· {connection.connectionKey}</span>
                    </div>

                    {(connection.machineName || connection.platform || connection.arch || connection.localExecutionRuntime) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                        {connection.machineName ? <span>{connection.machineName}</span> : null}
                        {connection.platform ? <span>· {connection.platform}</span> : null}
                        {connection.arch ? <span>· {connection.arch}</span> : null}
                        {connection.localExecutionRuntime ? <span>· {connection.localExecutionRuntime}</span> : null}
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(connection.status)}`}>
                      {connection.status}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-slate-400">
                      {connection.lastHeartbeatAt ? formatTime(connection.lastHeartbeatAt) : "no heartbeat"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                  <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.07] dark:text-slate-400">
                    inbox {connection.pendingInboxCount}
                  </span>
                  <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.07] dark:text-slate-400">
                    dispatch {connection.activeDispatchCount}
                  </span>
                  <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.07] dark:text-slate-400">
                    threads {connection.threadCount}
                  </span>
                  <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.07] dark:text-slate-400">
                    runs {connection.tasksRunCount}
                  </span>
                </div>

                {(connection.labels.length > 0 || connection.instruction) && (
                  <div className="mt-3 border-t border-black/[0.04] pt-2.5 dark:border-white/[0.05]">
                    {connection.labels.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {connection.labels.slice(0, 6).map((label) => (
                          <span
                            key={label}
                            className="rounded-full border border-ember-500/20 bg-ember-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ember-500"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}

                    {connection.instruction && (
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {connection.instruction}
                      </p>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
});
