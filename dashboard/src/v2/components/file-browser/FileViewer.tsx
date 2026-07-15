import type { FunctionComponent } from "preact";
import Editor from "@monaco-editor/react";
import { FileWarning, Loader2 } from "lucide-preact";
import type { FileBrowserFileContent } from "../../../types.js";
import { ensureMonacoConfigured, MONACO_DARK_THEME, MONACO_LIGHT_THEME } from "../../lib/monaco-setup.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { fileBrowserMessages } from "../../i18n/messages/file-browser.js";

interface FileViewerProps {
  file: FileBrowserFileContent | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
}

ensureMonacoConfigured();

const ViewerShell: FunctionComponent<{ children: preact.ComponentChildren }> = ({ children }) => (
  <div class="flex h-full w-full items-center justify-center overflow-y-auto bg-slate-50/35 p-10 text-center text-sm text-slate-500 dark:bg-void-950/45 dark:text-slate-400">
    {children}
  </div>
);

export const FileViewer: FunctionComponent<FileViewerProps> = ({ file, loading, error, isDark }) => {
  const { translate } = useDashboardI18n();
  const loadingStatusId = "file-viewer-refresh-status";
  const errorStatusId = "file-viewer-error-status";
  const statusId = file
    ? [loading ? loadingStatusId : null, error ? errorStatusId : null].filter(Boolean).join(" ") || undefined
    : undefined;

  if (loading && !file) {
    return (
      <ViewerShell>
        <span class="inline-flex items-center gap-2 text-balance break-words" role="status" aria-live="polite">
          <Loader2 class="shrink-0 h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
          {translate(fileBrowserMessages, "loadingFile")}
        </span>
      </ViewerShell>
    );
  }

  if (error && !file) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2 text-status-red text-balance break-words" role="alert">
          <span class="inline-flex items-center gap-2">
            <FileWarning class="shrink-0 h-4 w-4" strokeWidth={2} />
            {translate(fileBrowserMessages, "loadFileFailed")}
          </span>
          <span class="text-xs text-status-red/80">{error}</span>
          <span class="text-xs text-status-red/80">{translate(fileBrowserMessages, "retryFile")}</span>
        </span>
      </ViewerShell>
    );
  }

  if (!file) {
    return (
      <ViewerShell>
        <span class="flex flex-col gap-2 items-center text-slate-500 text-balance break-words" role="status">
          <span class="font-medium text-slate-700 dark:text-slate-300">{translate(fileBrowserMessages, "noFileSelected")}</span>
          <span>{translate(fileBrowserMessages, "selectFileDescription")}</span>
        </span>
      </ViewerShell>
    );
  }

  if (file.binary) {
    return (
      <ViewerShell>
        <span class="inline-flex flex-col items-center gap-2 text-balance break-words" role="status">
          <span class="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
            <FileWarning class="shrink-0 h-4 w-4 text-ember-500" strokeWidth={2} />
            {translate(fileBrowserMessages, "binaryDetected")}
          </span>
          <span>{translate(fileBrowserMessages, "binaryFileUnavailable")}</span>
        </span>
      </ViewerShell>
    );
  }

  return (
    <section
      class={`relative min-w-0 flex-1 h-full w-full ${loading || error ? "ring-1 ring-inset ring-ember-500/20" : ""}`}
      aria-label={translate(fileBrowserMessages, "fileContentsFor", { path: file.path })}
      aria-busy={loading}
      aria-describedby={statusId}
    >
      {loading && (
        <div id={loadingStatusId} class="absolute right-3 top-3 z-10 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-signal-500/20 bg-white/92 px-3 py-1.5 text-[11px] font-semibold text-signal-700 shadow-sm backdrop-blur-md dark:bg-void-900/92 dark:text-signal-300" role="status" aria-live="polite">
          <Loader2 class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2} />
          <span class="break-words">{translate(fileBrowserMessages, "refreshingFileCached")}</span>
        </div>
      )}
      {error && (
        <div id={errorStatusId} class="absolute left-3 right-3 top-3 z-10 rounded-xl border border-status-red/25 bg-white/94 px-3 py-2 text-xs text-status-red shadow-sm backdrop-blur-md dark:bg-void-900/94" role="alert">
          {translate(fileBrowserMessages, "refreshFileFailedCached", { error })}
        </div>
      )}
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
            {translate(fileBrowserMessages, "preparingEditor")}
          </span>
        )}
        options={{
          automaticLayout: true,
          readOnly: true,
          domReadOnly: true,
          ariaLabel: translate(fileBrowserMessages, "fileContentsFor", { path: file.path }),
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
    </section>
  );
};
