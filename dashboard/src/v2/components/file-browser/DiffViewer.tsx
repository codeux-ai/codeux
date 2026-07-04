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

const ViewerShell: FunctionComponent<{ children: preact.ComponentChildren; label: string }> = ({ children, label }) => (
  <div
    class="flex h-full w-full items-center justify-center overflow-y-auto bg-slate-50/60 p-6 text-center text-sm leading-6 text-slate-500 dark:bg-void-950/45 dark:text-slate-400 sm:p-10"
    aria-label={label}
  >
    {children}
  </div>
);

export const DiffViewer: FunctionComponent<DiffViewerProps> = ({ diff, loading, error, isDark, sideBySide }) => {
  if (loading) {
    return (
      <ViewerShell label="Diff viewer loading state">
        <span class="inline-flex max-w-full items-center gap-2 text-balance break-words" role="status" aria-live="polite">
          <Loader2 class="shrink-0 h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Computing diff…
        </span>
      </ViewerShell>
    );
  }

  if (error) {
    return (
      <ViewerShell label="Diff viewer error state">
        <span class="inline-flex max-w-full flex-col items-center gap-2 text-balance break-words text-status-red" role="alert">
          <span class="inline-flex items-center gap-2">
            <FileWarning class="shrink-0 h-4 w-4" strokeWidth={2} />
            Failed to load diff.
          </span>
          <span class="max-w-full break-words text-xs leading-5 text-status-red/80">{error}</span>
          <span class="text-xs text-status-red/80">Try selecting the change again.</span>
        </span>
      </ViewerShell>
    );
  }

  if (!diff) {
    return (
      <ViewerShell label="Diff viewer empty state">
        <span class="flex max-w-full flex-col items-center gap-2 text-balance break-words text-slate-500">
          <span class="font-medium text-slate-700 dark:text-slate-300">No change selected</span>
          <span>Select a changed file to see what changed versus the default branch.</span>
        </span>
      </ViewerShell>
    );
  }

  if (diff.binary) {
    return (
      <ViewerShell label="Diff viewer binary state">
        <span class="inline-flex max-w-full flex-col items-center gap-2 text-balance break-words" role="status">
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
    <div class="min-w-0 flex-1 h-full w-full" aria-label={`Diff viewer: ${diff.path}`}>
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
          fontSize: 13,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          padding: { top: 16, bottom: 16 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
    </div>
  );
};
