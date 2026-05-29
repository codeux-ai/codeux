import type { FunctionComponent } from "preact";
import { useState, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import gsap from "gsap";
import {
  Edit2, FileUp, Trash2, RefreshCw, AlertTriangle,
  ChevronDown, ChevronUp, Cpu, Route, Plug, Server, FileText,
  BrainCircuit, FolderGit2,
} from "lucide-preact";
import type { AgentPreset, CustomMcpServer } from "../../types.js";
import type { AgentProviderOption } from "./AgentPresetEditorPanel.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AgentAvatarStage } from "./AgentAvatarStage.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { getAccentHex } from "../../lib/agent-avatar.js";
import { resolveAgentMcpTags } from "../../lib/agent-mcp-display.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { MARKDOWN_PROSE_CLASS } from "../ui/MarkdownEditorField.js";
import { estimateTokens, formatTokenCount } from "../../lib/token-estimate.js";
import { renderMarkdown } from "../../../lib/markdown.js";

const INSTRUCTION_EXCERPT_CHARS = 320;
const INSTRUCTION_EXCERPT_LINES = 6;

function makeExcerpt(raw: string): { excerpt: string; truncated: boolean } {
  if (!raw) return { excerpt: "", truncated: false };
  const lines = raw.split(/\n/);
  let cutLines = false;
  let candidate = raw;
  if (lines.length > INSTRUCTION_EXCERPT_LINES) {
    candidate = lines.slice(0, INSTRUCTION_EXCERPT_LINES).join("\n");
    cutLines = true;
  }
  let cutChars = false;
  if (candidate.length > INSTRUCTION_EXCERPT_CHARS) {
    const slice = candidate.slice(0, INSTRUCTION_EXCERPT_CHARS);
    const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
    candidate = (lastBreak > INSTRUCTION_EXCERPT_CHARS - 80 ? slice.slice(0, lastBreak) : slice).trimEnd() + "…";
    cutChars = true;
  } else if (cutLines) {
    candidate = candidate.trimEnd() + "…";
  }
  return { excerpt: candidate, truncated: cutLines || cutChars };
}

const syncStatusDisplay = (preset: AgentPreset) => {
  switch (preset.syncStatus) {
    case "out_of_sync":
      return { cls: "border-amber-400/20 bg-amber-400/8 text-amber-600 dark:text-amber-400", label: "Out of Sync" };
    case "missing_source":
      return { cls: "border-status-red/20 bg-status-red/8 text-status-red", label: "Source Missing" };
    case "synced":
      return { cls: "border-signal-500/20 bg-signal-500/8 text-signal-600 dark:text-signal-400", label: preset.sourceScope === "project" ? "Project" : preset.sourceScope === "default" ? "Default" : "Home" };
    default:
      return { cls: "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400", label: "Database Only" };
  }
};

/* ── Quick-fact stat tile ── */
const StatTile: FunctionComponent<{
  label: string;
  value: string;
  iconNode: preact.ComponentChildren;
  accent?: boolean;
  rawIcon?: boolean;
}> = ({ label, value, iconNode, accent, rawIcon }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-white/40 p-3.5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
    {rawIcon ? (
      <span className="shrink-0">{iconNode}</span>
    ) : (
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent ? "bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400" : "bg-black/[0.04] text-slate-500 dark:bg-white/[0.05] dark:text-slate-300"}`}>
        {iconNode}
      </span>
    )}
    <div className="min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  </div>
);

/* ── Section header ── */
const SectionHeader: FunctionComponent<{
  icon: typeof FileText;
  title: string;
  tone?: "signal" | "violet";
  action?: preact.ComponentChildren;
}> = ({ icon: Icon, title, tone = "signal", action }) => {
  const toneCls = tone === "violet"
    ? "text-violet-600 dark:text-violet-400"
    : "text-signal-600 dark:text-signal-500";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} strokeWidth={2.4} />
        <h3 className={`text-[10px] font-bold uppercase tracking-[0.14em] ${toneCls}`}>{title}</h3>
      </div>
      {action}
    </div>
  );
};

export const AgentPresetDetailPanel: FunctionComponent<{
  preset: AgentPreset;
  routeTags: string[];
  providerOptions?: AgentProviderOption[];
  availableMcpServers?: CustomMcpServer[];
  onEdit: () => void;
  onDelete: (id: string) => void;
  onImport: (id: string) => void;
  deleting: boolean;
  importing: boolean;
}> = ({ preset, routeTags, providerOptions = [], availableMcpServers = [], onEdit, onDelete, onImport, deleting, importing }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeExpression, setActiveExpression] = useState<AgentAvatarExpression>("happy");
  const [instructionExpanded, setInstructionExpanded] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const accentHex = getAccentHex(preset.avatarConfig?.accent);
  const sync = syncStatusDisplay(preset);
  const selectedProvider = providerOptions.find((option) => option.value === preset.providerConfigId) || null;
  const mcpTags = resolveAgentMcpTags(preset.mcpAccess, availableMcpServers);
  const visibleMcpTags = mcpTags.slice(0, 6);
  const hiddenMcpTagCount = mcpTags.length - visibleMcpTags.length;

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(panelRef.current, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" });
    setInstructionExpanded(false);
    setMemoryExpanded(false);
  }, [preset.id]);

  const instructionView = useMemo(
    () => makeExcerpt(preset.instructionMarkdown ?? ""),
    [preset.instructionMarkdown]
  );
  const instructionTokens = useMemo(
    () => estimateTokens(preset.instructionMarkdown),
    [preset.instructionMarkdown]
  );
  const memoryView = useMemo(
    () => makeExcerpt(preset.memoryTemplateMarkdown ?? ""),
    [preset.memoryTemplateMarkdown]
  );
  const memoryTokens = useMemo(
    () => estimateTokens(preset.memoryTemplateMarkdown),
    [preset.memoryTemplateMarkdown]
  );

  return (
    <div
      ref={panelRef}
      className="group relative flex flex-col overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <WaveFluid accentHex={accentHex} />
      <BorderTrace accentHex={accentHex} />

      <div className="relative z-10 flex flex-col gap-6 p-6 md:p-8">
        {/* ── Profile hero: portrait + identity ── */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
          {/* Portrait */}
          <div className="lg:w-[300px] lg:shrink-0">
            <AgentAvatarStage
              config={preset.avatarConfig}
              expression={activeExpression}
              accentHex={accentHex}
              onExpressionChange={setActiveExpression}
              heightClass="h-[240px] lg:h-full lg:min-h-[260px]"
              className="h-full"
            />
          </div>

          {/* Identity */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-2.5">
                <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-500/60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal-500" />
                  </span>
                  Agent Profile
                </span>
                <h2 className="font-display text-3xl font-black tracking-tight text-slate-900 md:text-4xl dark:text-white">
                  {preset.name}
                </h2>
                {preset.description && (
                  <p className="max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {preset.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-signal-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-void-900"
              >
                <Edit2 className="h-4 w-4" strokeWidth={2.5} />
                Edit
              </button>
            </div>

            {/* Role + sync chips */}
            <div className="flex flex-wrap items-center gap-2">
              {routeTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ backgroundColor: `${accentHex}10`, color: accentHex }}
                >
                  {tag}
                </span>
              ))}
              {routeTags.length === 0 && (
                <span className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-500">
                  No assigned routes
                </span>
              )}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${sync.cls}`}>
                {preset.syncStatus === "out_of_sync" && <AlertTriangle className="h-3 w-3" strokeWidth={2.2} />}
                {sync.label}
              </span>
            </div>

            {/* Quick facts */}
            <div className="mt-auto grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile
                label="Provider"
                value={selectedProvider?.label || "Route default"}
                rawIcon={!!selectedProvider}
                iconNode={selectedProvider
                  ? <ProviderBrandIcon id={selectedProvider.provider} disabled={!selectedProvider.enabled} className="h-10 w-10 rounded-xl" imageClassName="h-5 w-5" />
                  : <Route className="h-4 w-4" strokeWidth={2.2} />}
              />
              <StatTile
                label="Model"
                value={preset.model || "Provider default"}
                iconNode={<Cpu className="h-4 w-4" strokeWidth={2.2} />}
              />
              <StatTile
                label="Connected MCPs"
                value={mcpTags.length === 0 ? "None" : `${mcpTags.length} server${mcpTags.length !== 1 ? "s" : ""}`}
                iconNode={<Server className="h-4 w-4" strokeWidth={2.2} />}
                accent={mcpTags.length > 0}
              />
              <StatTile
                label="System Prompt"
                value={preset.instructionMarkdown ? `~${formatTokenCount(instructionTokens)} tok` : "Empty"}
                iconNode={<FileText className="h-4 w-4" strokeWidth={2.2} />}
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent dark:via-white/[0.06]" />

        {/* Connected MCPs */}
        <div className="flex flex-col gap-3">
          <SectionHeader icon={Server} title="Connected MCPs" />
          <div className="flex flex-wrap items-center gap-2">
            {visibleMcpTags.map((tag) => (
              <span
                key={tag.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                  tag.kind === "code_ux"
                    ? "border-signal-500/25 bg-signal-500/[0.1] text-signal-700 dark:text-signal-200"
                    : "border-black/[0.08] bg-white/55 text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
                }`}
              >
                {tag.kind === "code_ux"
                  ? <Server className="h-3 w-3" strokeWidth={2.4} />
                  : <Plug className="h-3 w-3" strokeWidth={2.4} />}
                {tag.label}
              </span>
            ))}
            {hiddenMcpTagCount > 0 && (
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">+{hiddenMcpTagCount}</span>
            )}
            {mcpTags.length === 0 && (
              <span className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/50 px-2.5 py-1 text-[11px] font-bold text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-500">
                No MCP servers
              </span>
            )}
          </div>
        </div>

        {/* System Instructions */}
        <div className="flex flex-col gap-2">
          <SectionHeader
            icon={FileText}
            title="System Instructions"
            action={preset.instructionMarkdown ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/60 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
                ~{formatTokenCount(instructionTokens)} tok
              </span>
            ) : undefined}
          />
          {preset.instructionMarkdown ? (
            <div className="flex flex-col gap-2">
              <div
                className={`rounded-2xl border border-black/[0.05] bg-white/40 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02] ${MARKDOWN_PROSE_CLASS}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(instructionExpanded ? preset.instructionMarkdown : instructionView.excerpt) }}
              />
              {instructionView.truncated && (
                <button
                  type="button"
                  onClick={() => setInstructionExpanded((v) => !v)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-md transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                  aria-expanded={instructionExpanded}
                >
                  {instructionExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                      Show full ({preset.instructionMarkdown.length.toLocaleString()} chars)
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-black/[0.05] bg-white/40 p-5 text-sm italic leading-relaxed text-slate-400 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-slate-500">
              No instructions provided.
            </div>
          )}
        </div>

        {/* Memory override */}
        {preset.memoryTemplateOverrideEnabled && preset.memoryTemplateMarkdown && (
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={BrainCircuit}
              title="Memory Template Override"
              tone="violet"
              action={(
                <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/[0.06] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">
                  ~{formatTokenCount(memoryTokens)} tok
                </span>
              )}
            />
            <div
              className={`rounded-2xl border border-violet-500/15 bg-violet-500/[0.04] p-5 backdrop-blur-md dark:border-violet-500/15 dark:bg-violet-500/[0.06] ${MARKDOWN_PROSE_CLASS}`}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(memoryExpanded ? preset.memoryTemplateMarkdown : memoryView.excerpt) }}
            />
            {memoryView.truncated && (
              <button
                type="button"
                onClick={() => setMemoryExpanded((v) => !v)}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-violet-500/15 bg-violet-500/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600 transition-colors hover:bg-violet-500/[0.12] dark:text-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
                aria-expanded={memoryExpanded}
              >
                {memoryExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                    Show full ({preset.memoryTemplateMarkdown.length.toLocaleString()} chars)
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Source path */}
        {preset.sourcePath && (
          <div className="flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-white/30 px-5 py-3 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-400 dark:bg-white/[0.05] dark:text-slate-400">
              <FolderGit2 className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Markdown Source</span>
              <div className="break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{preset.sourcePath}</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.04] pt-6 dark:border-white/[0.04]">
          {preset.sourcePath && (
            <button
              type="button"
              onClick={() => onImport(preset.id)}
              disabled={importing || preset.syncStatus === "manual"}
              className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : <FileUp className="h-3.5 w-3.5" strokeWidth={2.2} />}
              Import
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(preset.id)}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          >
            {deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />}
            Delete
          </button>
          <span className="ml-auto font-mono text-[10px] text-slate-400 dark:text-slate-600">
            {preset.id}
          </span>
        </div>
      </div>
    </div>
  );
};
