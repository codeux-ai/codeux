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
  <div class="flex h-full w-full items-center justify-center p-10 text-center text-sm text-slate-500 dark:text-slate-400">
    {children}
  </div>
);

export const FileViewer: FunctionComponent<FileViewerProps> = ({ file, loading, error, isDark }) => {
  if (loading) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2">
          <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          Loading file…
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

  if (!file) {
    return (
      <ViewerShell>
        <span>Select a file from the tree to view its contents.</span>
      </ViewerShell>
    );
  }

  if (file.binary) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2">
          <FileWarning class="h-4 w-4 text-ember-500" strokeWidth={2} />
          Binary file — preview not available.
        </span>
      </ViewerShell>
    );
  }

  return (
    <Editor
      height="100%"
      theme={isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME}
      language={file.language ?? "plaintext"}
      path={file.path}
      value={file.content}
      beforeMount={ensureMonacoConfigured}
      loading={(
        <span class="inline-flex items-center gap-2 text-sm text-slate-500">
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
  );
};
