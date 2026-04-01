import type { ComponentChildren, FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  X,
} from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";

interface PreviewWindowChromeProps {
  session: SprintPreviewSession | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onReload: () => void;
  onAddressSubmit: (value: string) => void;
  addressValue: string;
  onAddressChange: (value: string) => void;
  children: ComponentChildren;
}

type WindowState = "normal" | "minimized" | "fullscreen" | "closed";

const statusTone: Record<SprintPreviewSession["status"], string> = {
  running: "border-signal-500/30 bg-signal-500/10 text-signal-500",
  starting: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  stopped: "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  error: "border-status-red/30 bg-status-red/10 text-status-red",
};

export const PreviewWindowChrome: FunctionComponent<PreviewWindowChromeProps> = ({
  session,
  onNavigateBack,
  onNavigateForward,
  onReload,
  onAddressSubmit,
  addressValue,
  onAddressChange,
  children,
}) => {
  const [windowState, setWindowState] = useState<WindowState>("normal");

  if (!session) {
    return (
      <div className="overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 shadow-[0_30px_80px_rgba(15,23,42,0.08)] dark:border-white/[0.06] dark:bg-[#05080d]/90 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="relative h-[calc(100vh-23rem)] min-h-[540px] bg-[#f6f8fb] dark:bg-[#04070b]">
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Compass className="h-12 w-12 text-slate-300 dark:text-slate-600" strokeWidth={1.5} />
            <h2 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-100">No preview active</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              Start a sprint preview to build the selected sprint into its own isolated container and browse it directly from the dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isFullscreen = windowState === "fullscreen";
  const isMinimized = windowState === "minimized";
  const isClosed = windowState === "closed";

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-white dark:bg-[#04070b]" : ""}>
      {/* Minimized state presentation */}
      {isMinimized && !isFullscreen && !isClosed && (
        <div className="rounded-2xl border border-black/[0.06] bg-[#f5f1e8] p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03] flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-status-red/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-signal-500/90" />
            </div>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {session.sprintName}
            </span>
            <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${statusTone[session.status]}`}>
              {session.status}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWindowState("normal")}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <Maximize2 className="h-3 w-3" strokeWidth={2.5} />
            Restore
          </button>
        </div>
      )}

      {/* Closed state presentation */}
      {isClosed && !isFullscreen && !isMinimized && (
        <div className="overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 shadow-[0_30px_80px_rgba(15,23,42,0.08)] dark:border-white/[0.06] dark:bg-[#05080d]/90 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)] mb-5">
          <div className="relative h-[calc(100vh-23rem)] min-h-[540px] bg-[#f6f8fb] dark:bg-[#04070b] flex flex-col items-center justify-center px-8 text-center">
            <div className="h-12 w-12 rounded-full border border-black/[0.08] flex items-center justify-center mb-4 dark:border-white/[0.08]">
              <X className="h-5 w-5 text-slate-400" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Window Closed</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
              The preview window is closed but the session is still running in the background. Stop the session to end the container, or reopen the window.
            </p>
            <button
              type="button"
              onClick={() => setWindowState("normal")}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-2xl border border-black/[0.08] px-4 text-sm font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
            >
              Reopen Window
            </button>
          </div>
        </div>
      )}

      {/* Active window chrome and hidden iframe container */}
      <div
        className={
          isMinimized || isClosed
            ? "hidden"
            : isFullscreen
              ? "flex flex-col h-full w-full"
              : "overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 shadow-[0_30px_80px_rgba(15,23,42,0.08)] dark:border-white/[0.06] dark:bg-[#05080d]/90 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
        }
      >
        <div className="border-b border-black/[0.06] bg-[#f5f1e8] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWindowState("closed")}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-status-red/80 hover:bg-status-red"
            >
              <X className="h-2 w-2 text-red-900 opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-within:opacity-100" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => setWindowState("minimized")}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-amber-400/80 hover:bg-amber-400"
            >
              <Minus className="h-2 w-2 text-amber-900 opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-within:opacity-100" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => setWindowState(isFullscreen ? "normal" : "fullscreen")}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-signal-500/90 hover:bg-signal-500"
            >
              {isFullscreen ? (
                <Minimize2 className="h-2 w-2 text-green-900 opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-within:opacity-100" strokeWidth={3} />
              ) : (
                <Maximize2 className="h-2 w-2 text-green-900 opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-within:opacity-100" strokeWidth={3} />
              )}
            </button>
          </div>
          <div className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${statusTone[session.status]}`}>
            {session.status}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onNavigateBack}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <form
            className="flex min-w-[240px] flex-1 items-center"
            onSubmit={(event) => {
              event.preventDefault();
              onAddressSubmit(addressValue);
            }}
          >
            <input
              value={addressValue}
              onInput={(event) => onAddressChange((event.currentTarget as HTMLInputElement).value)}
              className="h-10 w-full rounded-2xl border border-black/[0.08] bg-white/80 px-4 font-mono text-sm text-slate-800 outline-none transition focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100"
            />
          </form>
        </div>
      </div>
      <div
        className={
          isFullscreen
            ? "flex-1 bg-[#f6f8fb] dark:bg-[#04070b]"
            : "relative h-[calc(100vh-23rem)] min-h-[540px] bg-[#f6f8fb] dark:bg-[#04070b]"
        }
      >
        {children}
      </div>
      </div>
    </div>
  );
};
