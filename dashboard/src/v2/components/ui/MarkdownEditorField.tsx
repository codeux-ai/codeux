import type { JSX } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { PenLine, Eye } from "lucide-preact";
import { renderMarkdown } from "../../../lib/markdown.js";

type Mode = "write" | "preview";

/** Shared prose styling for rendered markdown previews across the app. */
export const MARKDOWN_PROSE_CLASS =
  "prose prose-sm max-w-none text-slate-950 dark:text-slate-300 " +
  "prose-headings:font-display prose-headings:tracking-tight prose-headings:text-slate-950 dark:prose-headings:text-white " +
  "prose-p:text-slate-950 dark:prose-p:text-slate-300 prose-li:text-slate-950 dark:prose-li:text-slate-300 " +
  "prose-strong:text-slate-950 dark:prose-strong:text-white prose-em:text-slate-950 dark:prose-em:text-slate-300 " +
  "prose-blockquote:text-slate-600 prose-blockquote:border-slate-300 dark:prose-blockquote:text-slate-400 dark:prose-blockquote:border-slate-700 " +
  "prose-table:text-slate-950 prose-th:text-slate-950 prose-td:text-slate-950 dark:prose-table:text-slate-300 dark:prose-th:text-white dark:prose-td:text-slate-300 " +
  "prose-a:text-slate-600 dark:prose-a:text-slate-400 prose-a:underline " +
  "prose-code:text-slate-600 dark:prose-code:text-slate-400 prose-code:bg-slate-500/[0.06] prose-code:px-1 prose-code:rounded-md " +
  "prose-pre:bg-black/[0.04] dark:prose-pre:bg-white/[0.04]";

/**
 * A markdown field with a Write/Preview toolbar. Defaults to the rendered
 * Preview when seeded with content (it reads much nicer), and falls back to
 * Write for empty fields so they stay immediately editable. The textarea
 * auto-grows up to {@link maxHeight}.
 */
export function MarkdownEditorField({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  minRows = 8,
  maxHeight = 520,
  minHeightClass = "min-h-[12rem]",
  disabled = false,
  invalid = false,
  ariaErrorId,
  toolbarNote,
  emptyPreviewHint = "Nothing to preview yet — switch to Write to add content.",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minRows?: number;
  maxHeight?: number;
  minHeightClass?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaErrorId?: string;
  toolbarNote?: preact.ComponentChildren;
  emptyPreviewHint?: string;
}) {
  const [mode, setMode] = useState<Mode>(value.trim() ? "preview" : "write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode !== "write") return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [mode, value, maxHeight]);

  const handleInput = (event: JSX.TargetedEvent<HTMLTextAreaElement>) => {
    onChange(event.currentTarget.value);
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white/40 backdrop-blur-md transition-all focus-within:border-signal-500 focus-within:ring-4 focus-within:ring-signal-500/10 dark:bg-white/[0.03] dark:focus-within:ring-signal-500/15 ${
        invalid ? "border-status-red/50" : "border-black/[0.05] dark:border-white/[0.07]"
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] bg-white/40 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          Markdown
        </span>
        <div className="flex items-center gap-2">
          {toolbarNote}
          <div role="tablist" aria-label="Markdown Editor Mode" className="flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-white/50 p-0.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
            {(["write", "preview"] as const).map((value_) => {
              const active = mode === value_;
              const Icon = value_ === "write" ? PenLine : Eye;
              return (
                <button
                  key={value_}
                  type="button"
                  onClick={() => setMode(value_)}
                  aria-pressed={active}
                  role="tab"
                  aria-selected={active}
                  aria-controls={value_ === "write" ? "markdown-editor" : "markdown-preview"}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    active
                      ? "bg-signal-500 text-void-900 shadow-[0_0_10px_rgba(0,224,160,0.22)]"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-3 w-3" strokeWidth={2.4} />
                  {value_ === "write" ? "Write" : "Preview"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {mode === "write" ? (
        <div role="tabpanel" id="markdown-editor" className="w-full">
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onInput={handleInput}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={minRows}
          disabled={disabled}
          spellcheck={false}
          aria-invalid={invalid}
          aria-errormessage={ariaErrorId}
          className={`block w-full resize-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-900 outline-none placeholder-slate-400 dark:text-white dark:placeholder-slate-600 ${minHeightClass}`}
        />
        </div>
      ) : (
        <div role="tabpanel" id="markdown-preview" aria-label="Markdown Preview" className="w-full">
          {value.trim() ? (
            <div
              className={`overflow-auto px-4 py-3.5 ${minHeightClass} ${MARKDOWN_PROSE_CLASS}`}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
            />
          ) : (
            <div className={`flex items-center px-4 py-3.5 text-[13px] italic text-slate-400 dark:text-slate-500 ${minHeightClass}`}>
              {emptyPreviewHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
