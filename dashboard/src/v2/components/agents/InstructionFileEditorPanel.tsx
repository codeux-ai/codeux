import type { FunctionComponent, JSX } from "preact";
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
  Save, RefreshCw, AlertCircle, Check, FileText, Eye, PenLine,
  RotateCcw, Sparkles, FolderGit2,
} from "lucide-preact";
import type { InstructionFileSummary, InstructionFileContent } from "../../lib/instruction-file-api.js";
import { fetchInstructionFile, saveInstructionFile } from "../../lib/instruction-file-api.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { getInstructionAccentHex, formatBytes } from "../../lib/instruction-file-display.js";
import { estimateTokens, formatTokenCount } from "../../lib/token-estimate.js";
import { renderMarkdown } from "../../../lib/markdown.js";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

const starterTemplate = (file: InstructionFileSummary): string =>
  `# ${file.label.replace(/\.md$/i, "")} instructions\n\n` +
  `Guidance for agents working in this repository.\n\n` +
  `## Project overview\n\n- \n\n## Conventions\n\n- \n\n## Commands\n\n\`\`\`bash\n\n\`\`\`\n`;

type Mode = "write" | "preview";

export const InstructionFileEditorPanel: FunctionComponent<{
  projectId: string;
  file: InstructionFileSummary;
  onSaved: (updated: InstructionFileContent) => void;
}> = ({ projectId, file, onSaved }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accentHex = getInstructionAccentHex(file.providerId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadedContent, setLoadedContent] = useState("");
  const [exists, setExists] = useState(file.exists);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [mode, setMode] = useState<Mode>("write");

  const dirty = content !== loadedContent;

  /* Load file content whenever the selected file changes */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMode("write");
    setJustSaved(false);
    fetchInstructionFile(projectId, file.id)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setLoadedContent(result.content);
        setExists(result.exists);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.id]);

  /* Entry animation on file switch */
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(panelRef.current, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" });
  }, [file.id]);

  const handleSave = useCallback(async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveInstructionFile(projectId, file.id, content);
      setLoadedContent(updated.content);
      setExists(updated.exists);
      onSaved(updated);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, dirty, projectId, file.id, content, onSaved]);

  /* Cmd/Ctrl+S to save */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const el = panelRef.current;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && !el.contains(active)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleInput = (event: JSX.TargetedEvent<HTMLTextAreaElement>) => {
    setContent(event.currentTarget.value);
  };

  const tokens = useMemo(() => estimateTokens(content), [content]);
  const previewHtml = useMemo(() => renderMarkdown(content), [content]);

  const status = saving
    ? { cls: "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400", label: "Saving", icon: <RefreshCw className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} /> }
    : dirty
      ? { cls: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400", label: "Unsaved", icon: <span className="h-1 w-1 rounded-full bg-amber-500" /> }
      : justSaved
        ? { cls: "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400", label: "Saved", icon: <Check className="h-2.5 w-2.5" strokeWidth={3} /> }
        : { cls: "border-black/[0.06] bg-white/60 text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400", label: exists ? "In sync" : "Not created", icon: <Check className="h-2.5 w-2.5" strokeWidth={3} /> };

  return (
    <div
      ref={panelRef}
      className="group relative flex flex-col overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <BorderTrace accentHex={accentHex} />

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 flex flex-col gap-4 border-b border-black/[0.05] bg-white/75 px-6 py-5 backdrop-blur-2xl md:flex-row md:items-center md:justify-between md:px-8 md:py-6 dark:border-white/[0.05] dark:bg-void-800/70">
        <div className="flex min-w-0 items-center gap-3.5">
          <div
            className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
            style={{ background: `linear-gradient(135deg, ${accentHex}26, ${accentHex}0d)` }}
          >
            <FileText className="h-6 w-6" style={{ color: accentHex }} strokeWidth={1.9} />
            {file.providerId && (
              <ProviderBrandIcon
                id={file.providerId}
                className="absolute -bottom-1 -right-1 h-5 w-5 rounded-md border-white/70 shadow-sm dark:border-void-800/70"
                imageClassName="h-3 w-3"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-xl font-black tracking-tight text-slate-900 dark:text-white">
                {file.label}
              </h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${status.cls}`}>
                {status.icon}
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
              <FolderGit2 className="h-3 w-3" strokeWidth={2.2} />
              <span className="truncate">{file.relativePath}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Write / Preview segmented toggle */}
          <div className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/50 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            {(["write", "preview"] as const).map((value) => {
              const active = mode === value;
              const Icon = value === "write" ? PenLine : Eye;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    active
                      ? "bg-signal-500 text-void-900 shadow-[0_0_12px_rgba(0,224,160,0.25)]"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                  {value === "write" ? "Write" : "Preview"}
                </button>
              );
            })}
          </div>

          {dirty && !saving && (
            <button
              type="button"
              onClick={() => setContent(loadedContent)}
              title="Revert changes"
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/40 px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600 backdrop-blur-md transition-colors hover:bg-white/70 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.4} />
              Revert
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            aria-disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:scale-100 dark:disabled:bg-white/[0.05] dark:disabled:text-slate-500"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : <Save className="h-3.5 w-3.5" strokeWidth={2.4} />}
            Save
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="relative z-10 flex flex-col gap-3 p-6 md:p-8">
        {error && (
          <div className="flex items-center gap-2 rounded-2xl border border-status-red/20 bg-status-red/[0.06] px-4 py-3 text-[13px] font-medium text-status-red backdrop-blur-md">
            <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            {error}
          </div>
        )}

        {/* Meta strip */}
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          <span className="font-mono normal-case tracking-normal">{content.length.toLocaleString()} chars</span>
          <span aria-hidden>·</span>
          <span className="font-mono normal-case tracking-normal">~{formatTokenCount(tokens)} tok</span>
          {exists && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono normal-case tracking-normal">{formatBytes(file.size)} on disk</span>
            </>
          )}
          <span className="ml-auto hidden items-center gap-1.5 font-mono normal-case tracking-normal md:inline-flex">
            {isMac ? "⌘S" : "Ctrl+S"} to save
          </span>
        </div>

        {loading ? (
          <div className="h-[60vh] min-h-[420px] animate-pulse rounded-2xl border border-black/[0.05] bg-white/40 dark:border-white/[0.05] dark:bg-white/[0.02]" />
        ) : mode === "write" ? (
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={content}
              onInput={handleInput}
              spellcheck={false}
              placeholder={`# ${file.label}\n\nWrite the instructions agents should follow in this project…`}
              className="block h-[60vh] min-h-[420px] w-full resize-y rounded-2xl border border-black/[0.05] bg-white/40 px-5 py-4 font-mono text-[13px] leading-relaxed text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15"
            />
            {!exists && content.trim() === "" && (
              <div className="pointer-events-none absolute inset-x-5 bottom-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setContent(starterTemplate(file))}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-signal-500/25 bg-white/85 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-signal-600 shadow-sm backdrop-blur-md transition-all hover:scale-[1.03] hover:bg-signal-500/10 dark:bg-void-800/85 dark:text-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
                  Insert starter template
                </button>
              </div>
            )}
          </div>
        ) : content.trim() ? (
          <div
            className="h-[60vh] min-h-[420px] overflow-auto rounded-2xl border border-black/[0.05] bg-white/40 px-6 py-5 backdrop-blur-md
                       prose prose-sm max-w-none text-slate-700 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-slate-300
                       prose-headings:font-display prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-white
                       prose-code:text-signal-600 dark:prose-code:text-signal-400 prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md
                       prose-a:text-signal-600 dark:prose-a:text-signal-400 prose-pre:bg-black/[0.04] dark:prose-pre:bg-white/[0.04]"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <div className="flex h-[60vh] min-h-[420px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/[0.08] bg-white/30 text-center dark:border-white/[0.08] dark:bg-white/[0.02]">
            <FileText className="h-8 w-8 text-slate-300 dark:text-slate-600" strokeWidth={1.4} />
            <p className="text-sm text-slate-400 dark:text-slate-500">Nothing to preview yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};
