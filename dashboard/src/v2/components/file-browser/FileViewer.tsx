import type { FunctionComponent } from "preact";
import Editor from "@monaco-editor/react";
import { FileWarning, Loader2 } from "lucide-preact";
import type { FileBrowserFileContent } from "../../../types.js";
import { ensureMonacoConfigured, MONACO_DARK_THEME, MONACO_LIGHT_THEME } from "../../lib/monaco-setup.js";

interface FileViewerProps {
  file: FileBrowserFileContent | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
}

ensureMonacoConfigured();

const ViewerShell: FunctionComponent<{ children: preact.ComponentChildren }> = ({ children }) => (
  <div class="flex h-full w-full items-center justify-center bg-slate-50/35 p-10 text-center text-sm text-slate-500 dark:bg-void-950/45 dark:text-slate-400">
    {children}
  </div>
);

export const FileViewer: FunctionComponent<FileViewerProps> = ({ file, loading, error, isDark }) => {
  if (loading) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2" role="status" aria-live="polite">
          <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Loading file…
        </span>
      </ViewerShell>
    );
  }

  if (error) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2 text-status-red" role="alert">
          <span class="inline-flex items-center gap-2">
            <FileWarning class="h-4 w-4" strokeWidth={2} />
            Failed to load file contents.
          </span>
          <span class="text-xs text-status-red/80">{error}</span>
          <span class="text-xs text-status-red/80">Try selecting the file again.</span>
        </span>
      </ViewerShell>
    );
  }

  if (!file) {
    return (
      <ViewerShell>
        <span class="flex flex-col gap-2 items-center text-slate-500">
          <span class="font-medium text-slate-700 dark:text-slate-300">No file selected</span>
          <span>Select a file from the tree to view its contents.</span>
        </span>
      </ViewerShell>
    );
  }

  if (file.binary) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2" role="status">
          <span class="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
            <FileWarning class="h-4 w-4 text-ember-500" strokeWidth={2} />
            Binary file detected
          </span>
          <span>File contents cannot be displayed in the editor.</span>
        </span>
      </ViewerShell>
    );
  }

  return (
    <div class="min-w-0 flex-1 h-full w-full">
      <Editor
        height="100%"
        theme={isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME}
        language={file.language ?? "plaintext"}
        path={file.path}
        value={file.content}
        beforeMount={ensureMonacoConfigured}
        loading={(
          <span class="inline-flex items-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
            <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
            Preparing editor…
          </span>
        )}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: true, scale: 0.8 },
          fontSize: 13,
          fontLigatures: true,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
          lineNumbersMinChars: 3,
          padding: { top: 16, bottom: 16 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
    </div>
  );
};
