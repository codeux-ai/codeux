import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { Server, Boxes, BrainCircuit, SlidersHorizontal, Wrench, Plug, X, Check } from "lucide-preact";
import type { AgentMcpAccessConfig, CustomMcpServer, McpToolToggle } from "../../types.js";
import { Dialog } from "../ui/Dialog.js";
import { Toggle } from "../ui/Toggle.js";
import { TOOL_DEFINITIONS, type McpToolCategory } from "../../../../../src/contracts/mcp-tool-definitions.js";

const CATEGORY_META: Record<McpToolCategory, { label: string; description: string; icon: typeof Server }> = {
  orchestration: { label: "Orchestration", description: "Projects, sprints, and tasks", icon: Boxes },
  agents_memory: { label: "Agents & Memory", description: "Agent presets and project memory", icon: BrainCircuit },
  platform: { label: "Platform", description: "Settings, previews, and telemetry", icon: SlidersHorizontal },
  advanced: { label: "Advanced", description: "Deprecated and low-level tools", icon: Wrench },
};

const CATEGORY_ORDER: McpToolCategory[] = ["orchestration", "agents_memory", "platform", "advanced"];

const buildToolToggles = (resolve: (name: string) => boolean): McpToolToggle[] =>
  TOOL_DEFINITIONS.map((def) => ({ name: def.name, enabled: resolve(def.name), isInternal: true }));

export const AgentMcpManageModal: FunctionComponent<{
  isOpen: boolean;
  onClose: () => void;
  value: AgentMcpAccessConfig;
  onChange: (next: AgentMcpAccessConfig) => void;
  availableServers: CustomMcpServer[];
}> = ({ isOpen, onClose, value, onChange, availableServers }) => {
  const toolEnabledByName = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const toggle of value.codeUxToolToggles) {
      map.set(toggle.name, toggle.enabled);
    }
    return map;
  }, [value.codeUxToolToggles]);

  const isToolEnabled = (name: string): boolean => toolEnabledByName.get(name) ?? true;

  const setCodeUxEnabled = (enabled: boolean): void => onChange({ ...value, codeUxEnabled: enabled });

  const setTool = (name: string, enabled: boolean): void =>
    onChange({ ...value, codeUxToolToggles: buildToolToggles((candidate) => (candidate === name ? enabled : isToolEnabled(candidate))) });

  const setCategory = (category: McpToolCategory, enabled: boolean): void => {
    const names = new Set(TOOL_DEFINITIONS.filter((def) => def.category === category).map((def) => def.name));
    onChange({ ...value, codeUxToolToggles: buildToolToggles((candidate) => (names.has(candidate as never) ? enabled : isToolEnabled(candidate))) });
  };

  const isLinked = (id: string): boolean => value.linkedServerIds.includes(id);
  const setLinked = (id: string, linked: boolean): void =>
    onChange({
      ...value,
      linkedServerIds: linked
        ? Array.from(new Set([...value.linkedServerIds, id]))
        : value.linkedServerIds.filter((entry) => entry !== id),
    });

  const enabledToolCount = TOOL_DEFINITIONS.filter((def) => isToolEnabled(def.name)).length;
  const linkedServerCount = availableServers.filter((server) => isLinked(server.id)).length;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} className="flex max-h-[88vh] w-[min(640px,94vw)] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
            <Plug className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
              MCP Access
            </div>
            <h2 className="font-display text-xl font-black tracking-tight text-slate-900 dark:text-white">
              Connected Servers
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              Choose which MCP servers and tools this agent may use when it runs.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white/60 text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
        >
          <X className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
        {/* Built-in code_ux */}
        <section className="rounded-2xl border border-black/[0.06] bg-white/40 p-5 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
                <Server className="h-4.5 w-4.5" strokeWidth={2.2} />
              </span>
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Code UX (built-in)</div>
                <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {value.codeUxEnabled ? `${enabledToolCount}/${TOOL_DEFINITIONS.length} tools enabled` : "Disabled for this agent"}
                </p>
              </div>
            </div>
            <Toggle value={value.codeUxEnabled} onChange={setCodeUxEnabled} aria-label="Enable Code UX for this agent" />
          </div>

          {value.codeUxEnabled && (
            <div className="mt-4 flex flex-col gap-3 border-t border-black/[0.05] pt-4 dark:border-white/[0.05]">
              {CATEGORY_ORDER.map((category) => {
                const meta = CATEGORY_META[category];
                const tools = TOOL_DEFINITIONS.filter((def) => def.category === category);
                if (tools.length === 0) return null;
                const allEnabled = tools.every((def) => isToolEnabled(def.name));
                const Icon = meta.icon;
                return (
                  <div key={category} className="rounded-xl border border-black/[0.05] bg-white/40 p-3.5 dark:border-white/[0.05] dark:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={2.2} />
                        <div>
                          <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{meta.label}</div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">{meta.description}</div>
                        </div>
                      </div>
                      <Toggle value={allEnabled} onChange={(enabled) => setCategory(category, enabled)} aria-label={`Enable all ${meta.label} tools`} />
                    </div>
                    <div className="mt-2.5 flex flex-col gap-1.5 border-t border-black/[0.04] pt-2.5 dark:border-white/[0.04]">
                      {tools.map((def) => (
                        <div key={def.name} className="flex items-center justify-between gap-3 pl-6">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">{def.name}</div>
                            <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">{def.description}</div>
                          </div>
                          <Toggle value={isToolEnabled(def.name)} onChange={(enabled) => setTool(def.name, enabled)} aria-label={`Enable ${def.name}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Custom servers */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Custom MCP servers</h3>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{linkedServerCount}/{availableServers.length} linked</span>
          </div>
          {availableServers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/30 px-5 py-6 text-center text-[12px] leading-relaxed text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-slate-500">
              No custom MCP servers configured. Add them in Settings → MCP, then link them here.
            </div>
          ) : (
            availableServers.map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.06] bg-white/40 px-4 py-3.5 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.02]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
                    <Plug className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{server.label || server.name}</span>
                      <span className="inline-flex h-5 items-center rounded-full border border-black/[0.08] bg-black/[0.03] px-2 text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-500">
                        {server.transport === "stdio" ? "stdio" : "HTTP"}
                      </span>
                      {server.enabled === false && (
                        <span className="inline-flex h-5 items-center rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-2 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
                          Off in settings
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                      {server.description || (server.transport === "stdio" ? server.command : server.url) || ""}
                    </div>
                  </div>
                </div>
                <Toggle value={isLinked(server.id)} onChange={(linked) => setLinked(server.id, linked)} aria-label={`Link ${server.label || server.name}`} />
              </div>
            ))
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          Done
        </button>
      </div>
    </Dialog>
  );
};
