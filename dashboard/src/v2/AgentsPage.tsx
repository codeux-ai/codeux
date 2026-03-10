import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  Bot,
  Brain,
  Clock3,
  PauseCircle,
  RefreshCw,
  Save,
  Sparkles,
  Workflow,
} from "lucide-preact";
import type { AgentConnection, McpConnectionStatus } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import { fetchProjectConnections, updateConnection as updateConnectionRequest } from "./lib/connection-api.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";

const STATUS_UI: Record<McpConnectionStatus, { label: string; accent: string; icon: typeof Activity; chip: string }> = {
  connected: { label: "Connected", accent: "#00E0A0", icon: Activity, chip: "text-signal-500 bg-signal-500/10 border-signal-500/20" },
  listening: { label: "Listening", accent: "#00E0A0", icon: Sparkles, chip: "text-signal-500 bg-signal-500/10 border-signal-500/20" },
  idle: { label: "Idle", accent: "#FFB800", icon: Clock3, chip: "text-ember-500 bg-ember-500/10 border-ember-500/20" },
  paused: { label: "Paused", accent: "#64748b", icon: PauseCircle, chip: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  stale: { label: "Stale", accent: "#F97316", icon: Clock3, chip: "text-orange-500 bg-orange-500/10 border-orange-500/20" },
  offline: { label: "Offline", accent: "#E3000F", icon: Bot, chip: "text-status-red bg-status-red/10 border-status-red/20" },
};

const timeAgo = (iso: string | null): string => {
  if (!iso) return "No heartbeat";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const roleLabel = (role: AgentConnection["role"]): string => role.replace("_", " ");

const EmptyState: FunctionComponent<{ hasProject: boolean }> = ({ hasProject }) => (
  <div className="relative overflow-hidden rounded-[2rem] border border-dashed border-signal-500/25 bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:bg-void-800/60 dark:border-signal-500/20 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <WaveFluid accentHex="#00E0A0" />
    <BorderTrace accentHex="#00E0A0" />
    <div className="relative z-10 flex flex-col items-center gap-3">
      <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-signal-500/10 text-signal-500">
        <Bot className="h-6 w-6" strokeWidth={1.6} />
      </div>
      <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
        {hasProject ? "No Connected MCPs Yet" : "Select A Project"}
      </h3>
      <p className="max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {hasProject
          ? "Use the new `start_listen` MCP tool to register a listener, worker, or project-manager connection against this project. Registered connections will appear here automatically."
          : "Choose a project from the top navigation to inspect its available MCP connections and listener state."}
      </p>
    </div>
  </div>
);

const AgentCard: FunctionComponent<{
  connection: AgentConnection;
  saving: boolean;
  onSave: (connection: AgentConnection, instruction: string) => Promise<void>;
}> = ({ connection, saving, onSave }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [instruction, setInstruction] = useState(String(connection.capabilities.instruction || ""));
  const status = STATUS_UI[connection.status] || STATUS_UI.idle;
  const Icon = status.icon;
  const model = typeof connection.capabilities.model === "string" ? connection.capabilities.model : "Unknown";

  useEffect(() => {
    setInstruction(String(connection.capabilities.instruction || ""));
  }, [connection.capabilities.instruction]);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 36, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "power3.out" }
    );
  }, []);

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-[1.85rem] border border-black/[0.06] bg-white/70 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <WaveFluid accentHex={status.accent} />
      <BorderTrace accentHex={status.accent} />

      <div className="relative z-10 flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-[1rem]"
              style={{ backgroundColor: `${status.accent}18` }}
            >
              <Icon className="h-5 w-5" strokeWidth={1.6} style={{ color: status.accent }} />
            </div>
            <div>
              <h3 className="font-display text-xl font-black tracking-tight text-slate-900 dark:text-white">
                {connection.displayName}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                <span>{roleLabel(connection.role)}</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span>{connection.transport}</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono">{model}</span>
              </div>
            </div>
          </div>

          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${status.chip}`}>
            {status.label}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Runs", value: connection.tasksRunCount, icon: Workflow },
            { label: "Threads", value: connection.threadCount, icon: Brain },
            { label: "Messages", value: connection.messageCount, icon: Bot },
            { label: "Inbox", value: connection.pendingInboxCount, icon: Sparkles },
          ].map(({ label, value, icon: StatIcon }) => (
            <div
              key={label}
              className="rounded-[1rem] border border-black/[0.04] bg-black/[0.03] px-3 py-4 text-center dark:border-white/[0.04] dark:bg-white/[0.03]"
            >
              <StatIcon className="mx-auto mb-2 h-3.5 w-3.5 text-slate-400" strokeWidth={1.8} />
              <div className="font-mono text-[1.4rem] font-black leading-none text-slate-900 dark:text-white">{value}</div>
              <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Listen Instruction</span>
            <span className="text-[9px] font-mono text-slate-400">{timeAgo(connection.lastHeartbeatAt)}</span>
          </div>
          <textarea
            value={instruction}
            onInput={(event) => setInstruction((event.target as HTMLTextAreaElement).value)}
            rows={5}
            className="min-h-[132px] w-full rounded-[1.2rem] border border-black/[0.08] bg-black/[0.03] px-4 py-3 text-sm leading-relaxed text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200"
            placeholder="Describe how this connection should behave when it receives dashboard messages."
          />
        </div>

        <div className="flex items-center justify-between border-t border-black/[0.05] pt-4 text-[10px] font-mono dark:border-white/[0.05]">
          <span className="truncate text-slate-400">{connection.connectionKey}</span>
          <button
            type="button"
            onClick={() => void onSave(connection, instruction)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 font-bold uppercase tracking-[0.12em] text-void-900 transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : <Save className="h-3.5 w-3.5" strokeWidth={2.1} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

type Filter = "all" | McpConnectionStatus;

export const AgentsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const { selectedProject, loading: projectLoading } = useProjectData();
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);

  const refreshConnections = async (): Promise<void> => {
    if (!selectedProject) {
      setConnections([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const nextConnections = await fetchProjectConnections(selectedProject.id);
      setConnections(nextConnections);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshConnections();
  }, [selectedProject?.id]);

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 34 },
      { opacity: 1, y: 0, duration: 0.85, stagger: 0.08, ease: "power4.out" }
    );
  }, []);

  const filteredConnections = useMemo(() => (
    filter === "all" ? connections : connections.filter((connection) => connection.status === filter)
  ), [connections, filter]);

  const counts = useMemo(() => ({
    all: connections.length,
    listening: connections.filter((connection) => connection.status === "listening").length,
    connected: connections.filter((connection) => connection.status === "connected").length,
    idle: connections.filter((connection) => connection.status === "idle").length,
    paused: connections.filter((connection) => connection.status === "paused").length,
    stale: connections.filter((connection) => connection.status === "stale").length,
    offline: connections.filter((connection) => connection.status === "offline").length,
  }), [connections]);

  const handleSaveInstruction = async (connection: AgentConnection, instruction: string): Promise<void> => {
    setSavingId(connection.id);
    try {
      const updated = await updateConnectionRequest(connection.id, {
        capabilities: {
          ...connection.capabilities,
          instruction: instruction.trim(),
        },
      });
      setConnections((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      window.alert(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="relative z-10 mx-auto flex max-w-[1880px] flex-col gap-12 px-8 py-20 md:px-20">
      <div ref={headerRef} className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.3} />
            MCP Connections
          </div>
          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute -left-2 -top-8 font-display text-[6rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03]">
              NODE
            </div>
            <h1 className="relative z-10 font-display text-5xl font-black tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Project <span className="text-signal-500">Connections.</span>
            </h1>
          </div>
          <p className="max-w-2xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
            {selectedProject
              ? `Connections registered for ${selectedProject.name}. Listener and worker MCP clients appear here as soon as they call the new listen tool surface.`
              : "Select a project to inspect its connected MCP listeners and workers."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: "all", label: "All", value: counts.all },
            { key: "listening", label: "Listening", value: counts.listening },
            { key: "connected", label: "Connected", value: counts.connected },
            { key: "idle", label: "Idle", value: counts.idle },
            { key: "paused", label: "Paused", value: counts.paused },
            { key: "stale", label: "Stale", value: counts.stale },
            { key: "offline", label: "Offline", value: counts.offline },
          ] as Array<{ key: Filter; label: string; value: number }>).map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                filter === chip.key
                  ? "border-signal-500/35 bg-signal-500/10 text-signal-500"
                  : "border-black/[0.06] bg-white/60 text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/[0.12] dark:hover:text-white"
              }`}
            >
              {chip.label} <span className="ml-1 font-mono">{chip.value}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refreshConnections()}
            disabled={loading || projectLoading}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2.2} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[1.5rem] border border-status-red/20 bg-status-red/10 px-5 py-4 text-sm text-status-red">
          {error}
        </div>
      )}

      {!selectedProject ? (
        <EmptyState hasProject={false} />
      ) : filteredConnections.length === 0 && !loading ? (
        <EmptyState hasProject />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {filteredConnections.map((connection) => (
            <AgentCard
              key={connection.id}
              connection={connection}
              saving={savingId === connection.id}
              onSave={handleSaveInstruction}
            />
          ))}
        </div>
      )}
    </div>
  );
};
