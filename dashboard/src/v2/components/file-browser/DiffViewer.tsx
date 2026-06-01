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
  <div class="flex h-full w-full items-center justify-center bg-slate-50/35 p-10 text-center text-sm text-slate-500 dark:bg-void-950/45 dark:text-slate-400">
    {children}
  </div>
);

export const DiffViewer: FunctionComponent<DiffViewerProps> = ({ diff, loading, error, isDark, sideBySide }) => {
  if (loading) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2">
          <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Computing diff…
        </span>
      </ViewerShell>
    );
  }

  if (error) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2 text-status-red">
          <FileWarning class="h-4 w-4" strokeWidth={2} />
          {error}
        </span>
      </ViewerShell>
    );
  }

  if (!diff) {
    return (
      <ViewerShell>
        <span>Select a changed file to see what changed versus the default branch.</span>
      </ViewerShell>
    );
  }

  if (diff.binary) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2">
          <FileWarning class="h-4 w-4 text-ember-500" strokeWidth={2} />
          Binary file — diff preview not available.
        </span>
      </ViewerShell>
    );
  }

  return (
    <DiffEditor
      height="100%"
      theme={isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME}
      language={diff.language ?? "plaintext"}
      original={diff.original ?? ""}
      modified={diff.modified ?? ""}
      beforeMount={ensureMonacoConfigured}
      loading={(
        <span class="inline-flex items-center gap-2 text-sm text-slate-500">
          <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Preparing diff…
        </span>
      )}
      options={{
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
  );
};
