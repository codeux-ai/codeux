import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, Download, Upload, Copy, Check } from "lucide-preact";

interface SprintMarkdownModalProps {
  mode: "import" | "export";
  sprintMarkdown?: string;
  tasksMarkdown?: string;
  sprintLabel?: string;
  onClose: () => void;
  onImport?: (payload: { sprintMarkdown: string; tasksMarkdown: string }) => Promise<void> | void;
}

export const SprintMarkdownModal: FunctionComponent<SprintMarkdownModalProps> = ({
  mode,
  sprintMarkdown = "",
  tasksMarkdown = "",
  sprintLabel,
  onClose,
  onImport,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [sprintText, setSprintText] = useState(sprintMarkdown);
  const [tasksText, setTasksText] = useState(tasksMarkdown);
  const [copiedField, setCopiedField] = useState<"sprint" | "tasks" | null>(null);

  useLayoutEffect(() => {
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    gsap.fromTo(cardRef.current, { y: 42, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power4.out" });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === backdropRef.current) {
      onClose();
    }
  };

  const handleCopy = async (kind: "sprint" | "tasks", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(kind);
    window.setTimeout(() => setCopiedField((current) => current === kind ? null : current), 1500);
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (mode !== "import" || !onImport) {
      return;
    }

    await onImport({ sprintMarkdown: sprintText, tasksMarkdown: tasksText });
    onClose();
  };

  const handleDownload = (fileName: string, text: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const title = mode === "import" ? "Import Sprint Markdown." : `Export ${sprintLabel || "Sprint"} Markdown.`;
  const subtitle = mode === "import"
    ? "Paste one sprint markdown document and an optional task bundle."
    : "Copy the generated sprint and task markdown bundle from the database state.";

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[220] flex items-center justify-center px-6 bg-black/55 dark:bg-black/75 backdrop-blur-xl"
    >
      <div
        ref={cardRef}
        className="relative w-full max-w-5xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"
      >
        <div className="relative w-56 shrink-0 bg-void-900 dark:bg-void-950 flex flex-col justify-between p-8 overflow-hidden">
          <span className="absolute -top-2 -left-4 text-[7.5rem] font-black text-white/[0.035] font-display leading-none pointer-events-none select-none tracking-tighter">
            {mode === "import" ? "LOAD" : "SAVE"}
          </span>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-44 h-44 ${mode === "import" ? "bg-signal-500/[0.08]" : "bg-ember-500/[0.08]"} animate-organic`} style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className={`absolute w-28 h-28 ${mode === "import" ? "bg-signal-500/[0.14]" : "bg-ember-500/[0.14]"} animate-organic-reverse`} style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
          </div>
          <div className={`relative z-10 flex items-center gap-2 ${mode === "import" ? "text-signal-500" : "text-ember-500"} font-mono font-bold text-[10px] tracking-[0.2em] uppercase`}>
            {mode === "import" ? <Upload className="w-3.5 h-3.5" strokeWidth={2.5} /> : <Download className="w-3.5 h-3.5" strokeWidth={2.5} />}
            {mode === "import" ? "Import Markdown" : "Export Markdown"}
          </div>
          <div className="relative z-10">
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 font-mono mb-1.5">Bundle</div>
            <div className="text-4xl font-black text-white font-display tracking-tight leading-none">
              {mode === "import" ? "IN" : "OUT"}
            </div>
            <div className={`mt-3 w-8 h-[2px] ${mode === "import" ? "bg-signal-500/50" : "bg-ember-500/50"}`} />
          </div>
        </div>

        <div className="flex-1 bg-white/98 dark:bg-void-800/98 p-8 flex flex-col">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h2 className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">
                {title}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                {subtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6 flex-1 min-h-0">
            <div className="grid grid-cols-1 gap-5 flex-1 min-h-0">
              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Markdown</label>
                  {mode === "export" && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(`${(sprintLabel || "sprint").replace(/\s+/g, "-").toLowerCase()}.md`, sprintText)}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ember-600 hover:text-ember-500 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleCopy("sprint", sprintText); }}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        {copiedField === "sprint" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedField === "sprint" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  value={sprintText}
                  onInput={(event) => setSprintText((event.target as HTMLTextAreaElement).value)}
                  readOnly={mode === "export"}
                  className="w-full min-h-[180px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:border-signal-500 resize-none font-mono"
                  placeholder="name: Sprint Name&#10;number: 1&#10;status: running&#10;goal:&#10;Describe the sprint scope."
                />
              </div>

              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Task Bundle</label>
                  {mode === "export" && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(`${(sprintLabel || "sprint").replace(/\s+/g, "-").toLowerCase()}-tasks.md`, tasksText)}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ember-600 hover:text-ember-500 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleCopy("tasks", tasksText); }}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        {copiedField === "tasks" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedField === "tasks" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  value={tasksText}
                  onInput={(event) => setTasksText((event.target as HTMLTextAreaElement).value)}
                  readOnly={mode === "export"}
                  className="w-full min-h-[240px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:border-signal-500 resize-none font-mono"
                  placeholder={'--- FILE: T01.md ---\ntitle: Task Title\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDetailed instructions'}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-400">
                {mode === "import" ? "Task bundle markers are optional. If omitted, the full textarea is treated as one task." : "Export reflects current DB state, not repo-local markdown files."}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  Close
                </button>
                {mode === "import" && (
                  <button
                    type="submit"
                    className="group/btn flex items-center gap-2.5 px-6 py-3 bg-signal-500 hover:bg-signal-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.4)] hover:-translate-y-px"
                  >
                    <Upload className="w-4 h-4" />
                    Import Sprint
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
