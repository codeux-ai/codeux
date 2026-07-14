import type { FunctionComponent } from "preact";
import { DiffEditor } from "@monaco-editor/react";
import { FileWarning, Loader2 } from "lucide-preact";
import type { FileBrowserDiff } from "../../../types.js";
import { ensureMonacoConfigured, MONACO_DARK_THEME, MONACO_LIGHT_THEME } from "../../lib/monaco-setup.js";

interface DiffViewerProps {
  diff: FileBrowserDiff | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
  sideBySide: boolean;
}

ensureMonacoConfigured();

const ViewerShell: FunctionComponent<{ children: preact.ComponentChildren }> = ({ children }) => (
  <div class="flex h-full w-full items-center justify-center overflow-y-auto bg-slate-50/35 p-10 text-center text-sm text-slate-500 dark:bg-void-950/45 dark:text-slate-400">
    {children}
  </div>
);

export const DiffViewer: FunctionComponent<DiffViewerProps> = ({ diff, loading, error, isDark, sideBySide }) => {
  const loadingStatusId = "diff-viewer-refresh-status";
  const errorStatusId = "diff-viewer-error-status";
  const statusId = diff
    ? [loading ? loadingStatusId : null, error ? errorStatusId : null].filter(Boolean).join(" ") || undefined
    : undefined;

  if (loading && !diff) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2 text-balance break-words" role="status" aria-live="polite">
          <Loader2 class="shrink-0 h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Computing diff…
        </span>
      </ViewerShell>
    );
  }

  if (error && !diff) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2 text-status-red text-balance break-words" role="alert">
          <span class="inline-flex items-center gap-2">
            <FileWarning class="shrink-0 h-4 w-4" strokeWidth={2} />
            Failed to load diff.
          </span>
          <span class="text-xs text-status-red/80">{error}</span>
          <span class="text-xs text-status-red/80">Try selecting the change again.</span>
        </span>
      </ViewerShell>
    );
  }

  if (!diff) {
    return (
      <ViewerShell>
        <span class="flex flex-col gap-2 items-center text-slate-500 text-balance break-words" role="status">
          <span class="font-medium text-slate-700 dark:text-slate-300">No change selected</span>
          <span>Select a changed file to see what changed versus the default branch.</span>
        </span>
      </ViewerShell>
    );
  }

  if (diff.binary) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2 text-balance break-words" role="status">
          <span class="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
            <FileWarning class="shrink-0 h-4 w-4 text-ember-500" strokeWidth={2} />
            Binary file detected
          </span>
          <span>Diff preview is not available for binary files.</span>
        </span>
      </ViewerShell>
    );
  }

  return (
    <section
      class={`relative min-w-0 flex-1 h-full w-full ${loading || error ? "ring-1 ring-inset ring-ember-500/20" : ""}`}
      aria-label={`Diff for ${diff.path}`}
      aria-busy={loading}
      aria-describedby={statusId}
    >
      {loading && (
        <div id={loadingStatusId} class="absolute right-3 top-3 z-10 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-signal-500/20 bg-white/92 px-3 py-1.5 text-[11px] font-semibold text-signal-700 shadow-sm backdrop-blur-md dark:bg-void-900/92 dark:text-signal-300" role="status" aria-live="polite">
          <Loader2 class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2} />
          <span class="break-words">Refreshing diff. Showing cached comparison.</span>
        </div>
      )}
      {error && (
        <div id={errorStatusId} class="absolute left-3 right-3 top-3 z-10 rounded-xl border border-status-red/25 bg-white/94 px-3 py-2 text-xs text-status-red shadow-sm backdrop-blur-md dark:bg-void-900/94" role="alert">
          Failed to refresh diff. Showing cached copy. {error}
        </div>
      )}
      <DiffEditor
        height="100%"
        theme={isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME}
        language={diff.language ?? "plaintext"}
        original={diff.original ?? ""}
        modified={diff.modified ?? ""}
        beforeMount={ensureMonacoConfigured}
        loading={(
          <span class="inline-flex items-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
            <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
            Preparing diff…
          </span>
        )}
        options={{
          automaticLayout: true,
          readOnly: true,
          domReadOnly: true,
          renderSideBySide: sideBySide,
          ariaLabel: `Diff for ${diff.path}`,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          padding: { top: 16, bottom: 16 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
    </section>
  );
};
