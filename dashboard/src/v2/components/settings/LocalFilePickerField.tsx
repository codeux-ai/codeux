import type { FunctionComponent } from "preact";
import { useId, useState } from "preact/hooks";
import { AlertCircle, Check, ChevronUp, FileText, FolderOpen, Home, Loader2, RefreshCw, X } from "lucide-preact";
import type { LocalFileBrowserResponse } from "../../types.js";
import { fetchLocalFiles } from "../../lib/project-api.js";
import { TextInput } from "./SettingsFormFields.js";

export const LocalFilePickerField: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  helperText?: string;
  placeholder?: string;
}> = ({ value, onChange, label, helperText, placeholder }) => {
  const generatedId = useId();
  const pickerId = `${generatedId}-picker`;
  const [isOpen, setIsOpen] = useState(false);
  const [listing, setListing] = useState<LocalFileBrowserResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadFiles = async (directoryPath?: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const nextListing = await fetchLocalFiles(directoryPath);
      setListing(nextListing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const openPicker = (): void => {
    setIsOpen(true);
    void loadFiles(value.trim() || undefined);
  };

  const refreshPath = listing?.currentPath || value.trim() || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <TextInput
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            helperText={helperText}
            aria-label={label}
            mono
          />
        </div>
        <button
          type="button"
          onClick={isOpen ? () => setIsOpen(false) : openPicker}
          aria-expanded={isOpen}
          aria-controls={pickerId}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-void-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white transition-[background-color,border-color,color,box-shadow,transform] hover:-translate-y-px hover:bg-void-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98] dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12] dark:focus-visible:ring-offset-void-900"
        >
          {isOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <FolderOpen aria-hidden="true" className="h-4 w-4" />}
          {isOpen ? "Close" : "Browse"}
        </button>
      </div>

      {isOpen ? (
        <div
          id={pickerId}
          className="overflow-hidden rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)]"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[color:var(--border-hairline)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => listing?.parentPath && void loadFiles(listing.parentPath)}
              disabled={!listing?.parentPath || isLoading}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
              aria-label={`${label}: go to parent directory`}
              title="Go to parent directory"
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void loadFiles(listing?.homePath)}
              disabled={isLoading}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
              aria-label={`${label}: go to home directory`}
              title="Go to home directory"
            >
              <Home aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void loadFiles(refreshPath)}
              disabled={isLoading}
              aria-busy={isLoading}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
              aria-label={`${label}: refresh current path`}
              title="Refresh current path"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? <span className="sr-only">Loading files</span> : null}
            </button>
            <div className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-600 dark:bg-white/[0.055] dark:text-slate-300">
              {listing?.currentPath || "Loading files..."}
            </div>
          </div>

          {error ? (
            <div role="alert" aria-live="assertive" className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-status-red">
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto p-2">
              {isLoading && !listing ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Loading files
                </div>
              ) : listing ? (
                <div className="grid gap-1">
                  {listing.directories.map((directory) => (
                    <button
                      key={directory.path}
                      type="button"
                      onClick={() => void loadFiles(directory.path)}
                      className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left font-mono text-xs font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                    >
                      <FolderOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-600 dark:text-signal-300" />
                      <span className="truncate">{directory.name}</span>
                    </button>
                  ))}
                  {listing.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => onChange(file.path)}
                      className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left font-mono text-xs font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] dark:text-slate-200 dark:hover:bg-white/[0.06] dark:hover:text-white"
                    >
                      <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-ember-600 dark:text-ember-300" />
                      <span className="truncate">{file.name}</span>
                      {value === file.path ? <Check aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-signal-600 dark:text-signal-300" /> : null}
                    </button>
                  ))}
                  {!listing.directories.length && !listing.files.length ? (
                    <div className="px-2 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      No child directories or files
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="px-2 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Open the picker to browse local files.
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
