import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowLeft, Boxes, BrainCircuit, Check, Copy, Download, Plus, RefreshCcw, Server, Settings2, SlidersHorizontal, Trash2, Wrench } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { CustomMcpServer, CustomMcpTransport, McpToolToggle, ProviderId } from "../../../../types.js";
import { NoticePanel } from "../SettingsSurface.js";
import { PillChoiceGroup, Row, TextInput, TextAreaInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { TOOL_DEFINITIONS, type McpToolCategory } from "../../../../../../src/contracts/mcp-tool-definitions.js";
import {
  fetchLocalMcpSetup,
  installLocalMcpProvider,
  regenerateLocalMcpToken,
  type LocalMcpCliProvider,
  type LocalMcpInstallResult,
  type LocalMcpSetupInfo,
} from "../../../lib/local-mcp-api.js";

const CATEGORY_META: Record<McpToolCategory, { label: string; description: string; icon: typeof Server }> = {
  orchestration: { label: "Orchestration", description: "Projects, sprints, and tasks", icon: Boxes },
  agents_memory: { label: "Agents & Memory", description: "Agent presets and project memory", icon: BrainCircuit },
  platform: { label: "Platform", description: "Settings, previews, and telemetry", icon: SlidersHorizontal },
  advanced: { label: "Advanced", description: "Deprecated and low-level tools", icon: Wrench },
};

const CATEGORY_ORDER: McpToolCategory[] = ["orchestration", "agents_memory", "platform", "advanced"];

const MCP_CAPABLE_PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "gemini", label: "Gemini" },
  { id: "codex", label: "Codex" },
  { id: "qwen-code", label: "Qwen Code" },
  { id: "opencode", label: "OpenCode" },
  { id: "antigravity", label: "Antigravity" },
];

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const Pill: FunctionComponent<{ label: string; tone?: "active" | "neutral" | "muted" }> = ({ label, tone = "neutral" }) => (
  <span
    className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[9px] font-bold uppercase tracking-[0.15em] ${
      tone === "active"
        ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:text-signal-200"
        : tone === "muted"
          ? "border-black/[0.06] bg-black/[0.025] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-500"
          : "border-black/[0.08] bg-black/[0.035] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-400"
    }`}
  >
    {label}
  </span>
);

const ActionChip: FunctionComponent<{
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  tone?: "primary" | "neutral" | "danger";
  disabled?: boolean;
}> = ({ label, icon: Icon, onClick, tone = "neutral", disabled = false }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[0.9rem] border px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-[background-color,border-color,color,transform,box-shadow] duration-200 hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 ${
      tone === "primary"
        ? "border-signal-500/25 bg-signal-500/[0.1] text-signal-700 shadow-[0_10px_24px_rgba(0,224,160,0.08)] hover:border-signal-500/35 hover:bg-signal-500/[0.15] dark:text-signal-200"
        : tone === "danger"
          ? "border-status-red/25 bg-status-red/[0.06] text-status-red hover:border-status-red/40 hover:bg-status-red/[0.1]"
          : "border-black/[0.08] bg-white/72 text-slate-600 hover:border-black/[0.14] hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-300 dark:hover:border-white/[0.14] dark:hover:bg-white/[0.08] dark:hover:text-white"
    }`}
  >
    <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    {label}
  </button>
);

const copyToClipboard = async (value: string): Promise<boolean> => {
  if (!navigator.clipboard) {
    return false;
  }
  await navigator.clipboard.writeText(value);
  return true;
};

const LocalHttpSetup: FunctionComponent = () => {
  const [setup, setSetup] = useState<LocalMcpSetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setSetup(await fetchLocalMcpSetup());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local MCP setup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const copyValue = async (key: string, value: string | null | undefined): Promise<void> => {
    if (!value) return;
    setError(null);
    try {
      await copyToClipboard(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setError("Clipboard write failed.");
    }
  };

  const regenerate = async (): Promise<void> => {
    setBusyAction("regenerate");
    setError(null);
    setMessage(null);
    try {
      const next = await regenerateLocalMcpToken();
      setSetup(next);
      setMessage("Token regenerated. Reinstall local CLI configs that should keep using this server.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate token.");
    } finally {
      setBusyAction(null);
    }
  };

  const install = async (provider: LocalMcpCliProvider): Promise<void> => {
    setBusyAction(provider);
    setError(null);
    setMessage(null);
    try {
      const result: LocalMcpInstallResult = await installLocalMcpProvider(provider);
      setMessage(`Installed ${setup?.providers.find((entry) => entry.id === provider)?.label ?? provider} config at ${result.configPath}. Keep Code UX running so the local MCP client can connect.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install CLI config.");
    } finally {
      setBusyAction(null);
    }
  };

  const configSnippet = setup?.url && setup.authToken
    ? `url: ${setup.url}\nAuthorization: Bearer ${setup.authToken}`
    : "";

  return (
    <div className="rounded-[1.35rem] border border-black/[0.08] bg-white/82 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] dark:border-white/[0.08] dark:bg-void-800/78">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Local CLI HTTP setup</h3>
              <Pill label={setup?.enabled ? "HTTP active" : "Disabled"} tone={setup?.enabled ? "active" : "muted"} />
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Add this running Code UX runtime as an authenticated Streamable HTTP MCP server for local CLI clients. Keep Code UX running while those clients connect. HTTPS needs a trusted certificate or a TLS reverse proxy; localhost HTTP uses the bearer token below.
            </p>
          </div>
          <ActionChip
            label={busyAction === "regenerate" ? "Regenerating" : "Regenerate token"}
            icon={RefreshCcw}
            onClick={() => { void regenerate(); }}
            disabled={loading || busyAction !== null || !setup?.enabled}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div className="min-w-0 rounded-[1rem] border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Server URL</div>
            <div className="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{loading ? "Loading..." : setup?.url ?? "MCP HTTP is disabled"}</div>
          </div>
          <div className="min-w-0 rounded-[1rem] border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Bearer token</div>
            <div className="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{loading ? "Loading..." : setup?.authToken ?? "Not available"}</div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <ActionChip label={copied === "url" ? "Copied" : "Copy URL"} icon={copied === "url" ? Check : Copy} onClick={() => { void copyValue("url", setup?.url); }} disabled={!setup?.url} />
            <ActionChip label={copied === "token" ? "Copied" : "Copy token"} icon={copied === "token" ? Check : Copy} onClick={() => { void copyValue("token", setup?.authToken); }} disabled={!setup?.authToken} />
            <ActionChip label={copied === "snippet" ? "Copied" : "Copy config"} icon={copied === "snippet" ? Check : Copy} onClick={() => { void copyValue("snippet", configSnippet); }} disabled={!configSnippet} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(setup?.providers ?? []).map((provider) => (
            <div key={provider.id} className="flex min-w-0 items-center justify-between gap-3 rounded-[1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{provider.label}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{provider.configPath}</div>
              </div>
              <button
                type="button"
                onClick={() => { void install(provider.id); }}
                disabled={!setup?.enabled || busyAction !== null}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[0.8rem] border border-black/[0.08] bg-white/82 px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:border-black/[0.14] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-300 dark:hover:text-white"
              >
                {busyAction === provider.id ? <RefreshCcw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                Install
              </button>
            </div>
          ))}
        </div>

        {message ? <div className="text-xs font-medium text-signal-700 dark:text-signal-200">{message}</div> : null}
        {error ? <div className="text-xs font-medium text-status-red">{error}</div> : null}
      </div>
    </div>
  );
};

type DetailView = { kind: "list" } | { kind: "internal" } | { kind: "custom"; id: string };

const maskUrl = (url: string): string => {
  if (!url) return "Not configured";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
};

const serverSubtitle = (server: CustomMcpServer): string => {
  if (server.description) return server.description;
  if (server.transport === "stdio") {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "No command set";
  }
  return maskUrl(server.url ?? "");
};

export const SettingsMcpPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { activeScope, systemSettings, projectSettings, updateSystem, updateProject } = state;

  const isProject = activeScope === "project";
  const [view, setView] = useState<DetailView>({ kind: "list" });

  const mcpTools: McpToolToggle[] = (isProject ? projectSettings?.mcpTools : systemSettings?.mcpTools) ?? [];
  const customServers: CustomMcpServer[] = (isProject ? projectSettings?.customMcpServers : systemSettings?.customMcpServers) ?? [];

  const writeTools = (next: McpToolToggle[]): void => {
    if (isProject) {
      updateProject((current) => ({ ...current, mcpTools: next }));
    } else {
      updateSystem((current) => ({ ...current, mcpTools: next }));
    }
  };

  const writeServers = (next: CustomMcpServer[]): void => {
    if (isProject) {
      updateProject((current) => ({ ...current, customMcpServers: next }));
    } else {
      updateSystem((current) => ({ ...current, customMcpServers: next }));
    }
  };

  const enabledByName = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const tool of mcpTools) {
      map.set(tool.name, tool.enabled);
    }
    return map;
  }, [mcpTools]);

  const normalizedTools = useMemo(() => TOOL_DEFINITIONS.map((def) => ({
    name: def.name as string,
    enabled: enabledByName.get(def.name) ?? true,
    isInternal: true,
  })), [enabledByName]);

  const enabledToolCount = normalizedTools.filter((tool) => tool.enabled).length;

  const setToolEnabled = (name: string, enabled: boolean): void => {
    writeTools(normalizedTools.map((tool) => (tool.name === name ? { ...tool, enabled } : tool)));
  };

  const setCategoryEnabled = (category: McpToolCategory, enabled: boolean): void => {
    const namesInCategory = new Set(TOOL_DEFINITIONS.filter((def) => def.category === category).map((def) => def.name));
    writeTools(normalizedTools.map((tool) => (namesInCategory.has(tool.name as any) ? { ...tool, enabled } : tool)));
  };

  const addServer = (): void => {
    const id = (globalThis.crypto?.randomUUID?.() ?? `mcp_${Date.now()}`);
    const next: CustomMcpServer = { id, name: "", label: "", enabled: true, transport: "http", url: "" };
    writeServers([...customServers, next]);
    setView({ kind: "custom", id });
  };

  const updateServer = (id: string, patch: Partial<CustomMcpServer>): void => {
    writeServers(customServers.map((server) => (server.id === id ? { ...server, ...patch } : server)));
  };

  const removeServer = (id: string): void => {
    writeServers(customServers.filter((server) => server.id !== id));
    setView({ kind: "list" });
  };

  const backButton = (
    <button
      type="button"
      onClick={() => setView({ kind: "list" })}
      className="inline-flex items-center gap-2 self-start rounded-full border border-black/[0.08] bg-white/72 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:border-black/[0.14] hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-300 dark:hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All MCP servers
    </button>
  );

  // ---- Internal MCP detail view ----
  if (view.kind === "internal") {
    return (
      <>
        {backButton}
        <SectionCard title="Built-in MCP (Code UX)" watermark="MCP" icon={<Server strokeWidth={2.4} />} badge={`${enabledToolCount} enabled`}>
          <NoticePanel title="Tool access">
            Toggle which Code UX tools the containerized CLIs may call. Disable a whole category or individual tools. Changes apply on the next CLI run.
          </NoticePanel>
        </SectionCard>

        {CATEGORY_ORDER.map((category) => {
          const meta = CATEGORY_META[category];
          const toolsInCategory = TOOL_DEFINITIONS.filter((def) => def.category === category);
          if (toolsInCategory.length === 0) return null;
          const allEnabled = toolsInCategory.every((def) => enabledByName.get(def.name) ?? true);
          const Icon = meta.icon;
          return (
            <SectionCard
              key={category}
              title={meta.label}
              sectionId={`mcp-tool-category-${category}`}
              icon={<Icon strokeWidth={2.4} />}
              badge={`${toolsInCategory.filter((def) => enabledByName.get(def.name) ?? true).length}/${toolsInCategory.length}`}
              helpId="mcp-tool-category"
            >
              <Row label={`Enable all ${meta.label.toLowerCase()} tools`} description={meta.description}>
                <Toggle aria-label="Toggle setting" value={allEnabled} onChange={(value) => setCategoryEnabled(category, value)} />
              </Row>
              {toolsInCategory.map((def, index) => (
                <Row
                  key={def.name}
                  label={def.name}
                  description={def.description}
                  last={index === toolsInCategory.length - 1}
                >
                  <Toggle aria-label="Toggle setting"                     value={enabledByName.get(def.name) ?? true}
                    onChange={(value) => setToolEnabled(def.name, value)}
                  />
                </Row>
              ))}
            </SectionCard>
          );
        })}
      </>
    );
  }

  // ---- Custom server detail view ----
  if (view.kind === "custom") {
    const server = customServers.find((entry) => entry.id === view.id);
    if (!server) {
      return (
        <>
          {backButton}
          <SectionCard title="MCP server" icon={<Server strokeWidth={2.4} />}>
            <NoticePanel title="Server not found" tone="warning">This MCP server is no longer available.</NoticePanel>
          </SectionCard>
        </>
      );
    }
    return (
      <>
        {backButton}
        <CustomServerDetail
          server={server}
          canRemove={!isProject}
          onChange={(patch) => updateServer(server.id, patch)}
          onRemove={() => removeServer(server.id)}
        />
      </>
    );
  }

  // ---- List view ----
  return (
    <>
      <SectionCard title="MCP Servers" watermark="MCP" icon={<Server strokeWidth={2.4} />} drilldown={false}>
        <LocalHttpSetup />

        <div className="grid gap-3 md:grid-cols-2">
          {/* Built-in MCP card */}
          <div className="group relative min-h-[156px] overflow-hidden rounded-[1.35rem] border border-signal-500/24 bg-white/90 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.07)] dark:border-signal-400/24 dark:bg-void-800/82">
            <div aria-hidden className="absolute left-0 top-5 bottom-5 w-1 rounded-r-full bg-signal-500 dark:bg-signal-400" />
            <div className="flex h-full flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[0.9rem] border border-signal-500/25 bg-signal-500/[0.1] text-signal-600 dark:text-signal-300">
                  <Server className="h-5 w-5" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">Code UX (built-in)</div>
                    <Pill label="Always on" tone="active" />
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Our internal MCP server. Manage which tool categories and tools the CLIs can call.
                  </div>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pl-13">
                <Pill label={`${enabledToolCount}/${normalizedTools.length} tools`} tone={enabledToolCount > 0 ? "neutral" : "muted"} />
                <ActionChip label="Configure" icon={Settings2} onClick={() => setView({ kind: "internal" })} />
              </div>
            </div>
          </div>

          {/* Custom server cards */}
          {customServers.map((server) => {
            const active = server.enabled;
            return (
              <div
                key={server.id}
                className={`group relative min-h-[156px] overflow-hidden rounded-[1.35rem] border p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.07)] ${
                  active
                    ? "border-signal-500/24 bg-white/90 dark:border-signal-400/24 dark:bg-void-800/82"
                    : "border-black/[0.06] bg-white/88 dark:border-white/[0.08] dark:bg-void-800/78"
                }`}
              >
                <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full transition-opacity ${active ? "bg-signal-500 opacity-100 dark:bg-signal-400" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[0.9rem] border border-black/[0.08] bg-black/[0.03] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                      <Server className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{server.label || server.name || "Untitled server"}</div>
                        {active ? <Pill label="Active" tone="active" /> : <Pill label="Disabled" tone="muted" />}
                      </div>
                      <div className="mt-1 truncate text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {serverSubtitle(server)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill label={server.transport === "stdio" ? "stdio" : "HTTP"} />
                      <Pill label={!server.providers || server.providers.length === 0 ? "All CLIs" : `${server.providers.length} CLIs`} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle aria-label="Toggle setting" value={server.enabled} onChange={(value) => updateServer(server.id, { enabled: value })} />
                      <ActionChip label="Manage" icon={Settings2} onClick={() => setView({ kind: "custom", id: server.id })} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {isProject ? (
          <NoticePanel title="Add servers at system scope" tone="neutral">
            New custom servers are added at system scope so every project inherits them. Switch to system scope to add a server. Here you can enable, disable, or override inherited servers.
          </NoticePanel>
        ) : (
          <div className="flex justify-end">
            <ActionChip label="Add MCP server" icon={Plus} tone="primary" onClick={addServer} />
          </div>
        )}
      </SectionCard>
    </>
  );
};

const JsonMapEditor: FunctionComponent<{
  resetKey: string;
  value?: Record<string, string>;
  placeholder: string;
  "aria-label"?: string;
  onChange: (value: Record<string, string> | undefined) => void;
}> = ({ resetKey, value, placeholder, "aria-label": ariaLabel, onChange }) => {
  const [text, setText] = useState<string>(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    setError(null);
  }, [resetKey]);

  const handle = (next: string): void => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      setError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Expected a JSON object of string values.");
        return;
      }
      const out: Record<string, string> = {};
      for (const [key, raw] of Object.entries(parsed)) {
        if (typeof raw !== "string") {
          setError(`"${key}" must be a string value.`);
          return;
        }
        out[key] = raw;
      }
      setError(null);
      onChange(Object.keys(out).length > 0 ? out : undefined);
    } catch {
      setError("Invalid JSON.");
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <TextAreaInput value={text} onChange={handle} rows={5} placeholder={placeholder} aria-label={ariaLabel} />
      {error ? <span className="text-[11px] font-medium text-status-red">{error}</span> : null}
    </div>
  );
};

const TRANSPORT_OPTIONS: Array<{ value: CustomMcpTransport; label: string; hint: string }> = [
  { value: "http", label: "HTTP / SSE", hint: "Remote server via URL" },
  { value: "stdio", label: "Command (stdio)", hint: "Local process, e.g. npx" },
];

const CustomServerDetail: FunctionComponent<{
  server: CustomMcpServer;
  canRemove: boolean;
  onChange: (patch: Partial<CustomMcpServer>) => void;
  onRemove: () => void;
}> = ({ server, canRemove, onChange, onRemove }) => {
  const nameValid = NAME_PATTERN.test(server.name);
  const restricted = server.providers ?? [];
  const isStdio = server.transport === "stdio";

  const toggleProvider = (id: ProviderId): void => {
    const set = new Set(restricted);
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    const next = Array.from(set);
    onChange({ providers: next.length === 0 ? undefined : next });
  };

  const onArgsChange = (value: string): void => {
    const args = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    onChange({ args: args.length > 0 ? args : undefined });
  };

  const previewConfig = {
    mcpServers: {
      [server.name || "server_name"]: isStdio
        ? {
            command: server.command || "npx",
            ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
            ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
          }
        : {
            type: "http",
            url: server.url || "https://...",
            ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
          },
    },
  };

  return (
    <SectionCard sectionId={`custom-mcp-${server.id}`} title={server.label || server.name || "MCP server"} watermark="MCP" icon={<Server strokeWidth={2.4} />} helpId="custom-mcp-server">
      <NoticePanel title="HTTP / SSE setup">
        Choose HTTP / SSE for a remote MCP server that already exposes an HTTP or SSE endpoint. Paste the server URL below, add optional auth headers as a JSON object, and Code UX injects the updated config on the next CLI run.
      </NoticePanel>
      <Row label="Display name" description="Shown on the MCP servers list.">
        <TextInput value={server.label ?? ""} onChange={(value) => onChange({ label: value })} placeholder="Playwright" />
      </Row>
      <Row label="Server key" description="Identifier used in each CLI's mcpServers config. Letters, numbers, dash, underscore.">
        <div className="flex flex-col gap-1.5">
          <TextInput value={server.name} onChange={(value) => onChange({ name: value })} placeholder="playwright" mono />
          {!nameValid && server.name.length > 0 ? (
            <span className="text-[11px] font-medium text-status-red">Only letters, numbers, dash, and underscore are allowed.</span>
          ) : null}
        </div>
      </Row>
      <Row label="Transport" description="HTTP/SSE for remote servers, or a local command (stdio) like npx.">
        <PillChoiceGroup
          value={server.transport}
          onChange={(value) => onChange({ transport: value as CustomMcpTransport })}
          options={TRANSPORT_OPTIONS}
        />
      </Row>

      {isStdio ? (
        <>
          <Row label="Command" description="Executable to launch the MCP server. Must be available inside the CLI container.">
            <TextInput value={server.command ?? ""} onChange={(value) => onChange({ command: value })} placeholder="npx" mono />
          </Row>
          <Row label="Arguments" description="One argument per line.">
            <TextAreaInput value={(server.args ?? []).join("\n")} onChange={onArgsChange} rows={4} placeholder={"@playwright/mcp@latest"} />
          </Row>
          <Row label="Environment (JSON)" description="Optional object of env var name to value passed to the command.">
            <JsonMapEditor resetKey={server.id} value={server.env} placeholder={'{\n  "API_KEY": "..."\n}'} aria-label="Environment JSON" onChange={(env) => onChange({ env })} />
          </Row>
        </>
      ) : (
        <>
          <Row label="Server URL" description="Paste the HTTP or SSE endpoint URL provided by the MCP server.">
            <TextInput value={server.url ?? ""} onChange={(value) => onChange({ url: value })} placeholder="https://example.com/mcp" mono aria-label="Server URL" />
          </Row>
          <Row label="Auth headers (JSON)" description="Optional JSON object of header names to string values, for example Authorization tokens.">
            <JsonMapEditor resetKey={server.id} value={server.headers} placeholder={'{\n  "Authorization": "Bearer ..."\n}'} aria-label="Auth headers JSON" onChange={(headers) => onChange({ headers })} />
          </Row>
        </>
      )}

      <Row label="Description" description="Optional note shown on the card.">
        <TextInput value={server.description ?? ""} onChange={(value) => onChange({ description: value })} placeholder="Browser automation tools" />
      </Row>
      <Row label="Restrict to CLIs" description="Leave all unselected to inject into every MCP-capable CLI.">
        <div className="flex flex-wrap gap-2">
          {MCP_CAPABLE_PROVIDERS.map((provider) => {
            const selected = restricted.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => toggleProvider(provider.id)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                  selected
                    ? "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-200"
                    : "border-black/[0.08] bg-white/72 text-slate-500 hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {provider.label}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Effective config preview" description="How this server is injected into a Claude Code container." last>
        <pre role="region" aria-label={`${server.id} generated MCP configuration preview`} className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          {JSON.stringify(previewConfig, null, 2)}
        </pre>
      </Row>

      {canRemove ? (
        <div className="flex justify-end pt-1">
          <ActionChip label="Remove server" icon={Trash2} tone="danger" onClick={onRemove} />
        </div>
      ) : null}
    </SectionCard>
  );
};
