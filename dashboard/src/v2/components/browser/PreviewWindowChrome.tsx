import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  X,
  Play,
  Square,
  AlertCircle,
  Loader2,
} from "lucide-preact";
import type { SprintPreviewPortMapping, SprintPreviewSession } from "../../../types.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";
import { formatPreviewPortTabLabel } from "../../lib/preview-origin.js";
import { useDashboardI18n } from "../../i18n/index.js";
import {
  browserPreviewMessages,
  type BrowserPreviewMessageKey,
  type BrowserPreviewMessageVariables,
} from "../../i18n/messages/browser-preview.js";

interface PreviewWindowChromeProps {
  session: SprintPreviewSession | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onReload: () => void;
  onAddressSubmit: (value: string) => void;
  addressValue: string;
  onAddressChange: (value: string) => void;
  navigationEnabled?: boolean;
  navigationBusy?: boolean;
  navigationDisabledReason?: string;
  portMappings?: SprintPreviewPortMapping[];
  selectedContainerPort?: number | null;
  onSelectPort?: (containerPort: number) => void;
  children: ComponentChildren;
}

type WindowState = "normal" | "minimized" | "fullscreen" | "closed";

const statusTone: Record<SprintPreviewSession["status"], string> = {
  running: "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400",
  starting: "border-ember-500/30 bg-ember-500/10 text-ember-600 dark:text-ember-400",
  stopped: "border-slate-400/25 bg-slate-500/10 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300",
  error: "border-status-red/30 bg-status-red/10 text-status-red",
};

const controlTransition = buildInteractionTransition("controlFeedback");
const windowTransition = buildInteractionTransition("enterExit", "opacity, transform");

export const PreviewWindowChrome: FunctionComponent<PreviewWindowChromeProps> = ({
  session,
  onNavigateBack,
  onNavigateForward,
  onReload,
  onAddressSubmit,
  addressValue,
  onAddressChange,
  navigationEnabled = true,
  navigationBusy = false,
  navigationDisabledReason,
  portMappings = [],
  selectedContainerPort = null,
  onSelectPort,
  children,
}) => {
  const { translate } = useDashboardI18n();
  const t = (key: BrowserPreviewMessageKey, variables?: BrowserPreviewMessageVariables) => (
    translate(browserPreviewMessages, key, variables)
  );
  const statusLabel: Record<SprintPreviewSession["status"], string> = {
    running: t("statusRunning"),
    starting: t("statusStarting"),
    stopped: t("statusStopped"),
    error: t("statusError"),
  };
  const [windowState, setWindowState] = useState<WindowState>("normal");
  const [navigationAnnouncement, setNavigationAnnouncement] = useState("");
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const lastChromeControlRef = useRef<HTMLButtonElement | null>(null);
  const previousWindowStateRef = useRef<WindowState>("normal");
  const portTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const isFullscreen = windowState === "fullscreen";
  const isMinimized = windowState === "minimized";
  const isClosed = windowState === "closed";

  const containerDescriptionId = "preview-address-disabled-description";
  const navigationPendingDescriptionId = "preview-navigation-pending-description";
  const addressLabelId = "preview-address-label";
  const controlsDisabled = !navigationEnabled || navigationBusy;
  const disabledDescriptionId = navigationBusy ? navigationPendingDescriptionId : containerDescriptionId;
  const sessionName = session?.sprintName || t("selectedPreview");
  const normalizedPath = addressValue || "/";
  const windowStateMessage = windowState === "normal"
    ? t("windowOpen")
    : windowState === "fullscreen"
      ? t("windowFullscreen")
      : windowState === "minimized"
        ? t("windowMinimized")
        : t("windowClosedAnnouncement");
  const navigationDescription = navigationBusy
    ? t("navigationPendingReason")
    : navigationDisabledReason || t("navigationDefaultReason");
  const visiblePortMappings = portMappings.length > 1 ? portMappings : [];

  const announceNavigation = (message: string) => {
    setNavigationAnnouncement(message);
  };

  const rememberChromeControl = (element: HTMLButtonElement | null) => {
    lastChromeControlRef.current = element;
  };

  const restoreChromeControlFocus = () => {
    const target = lastChromeControlRef.current;
    if (target && target.isConnected) {
      target.focus({ preventScroll: true });
    }
  };

  const selectPortTab = (mapping: SprintPreviewPortMapping) => {
    onSelectPort?.(mapping.containerPort);
    queueMicrotask(() => {
      portTabRefs.current[mapping.containerPort]?.focus({ preventScroll: true });
    });
  };

  const handlePortTabKeyDown = (event: KeyboardEvent, index: number) => {
    if (visiblePortMappings.length === 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = index === visiblePortMappings.length - 1 ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = index === 0 ? visiblePortMappings.length - 1 : index - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visiblePortMappings.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextMapping = visiblePortMappings[nextIndex];
    if (nextMapping) {
      selectPortTab(nextMapping);
    }
  };

  useEffect(() => {
    if (isMinimized && !isClosed) {
      restoreButtonRef.current?.focus({ preventScroll: true });
    }
    if (isClosed) {
      reopenButtonRef.current?.focus({ preventScroll: true });
    }
    if (windowState === "normal" && previousWindowStateRef.current !== "normal") {
      queueMicrotask(restoreChromeControlFocus);
    }
    previousWindowStateRef.current = windowState;
  }, [isClosed, isMinimized, windowState]);

  if (!session) {
    return (
      <div className="flex min-h-[18rem] flex-col items-center justify-center px-6 py-16 text-center" role="status" aria-live="polite">
        <Compass className="h-12 w-12 text-slate-300 dark:text-slate-600" strokeWidth={1.5} />
        <h2 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-100">{t("noPreviewActive")}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("noPreviewActiveDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-white dark:bg-[#04070b]" : ""}>
      {/* Minimized state presentation */}
      {isMinimized && !isFullscreen && !isClosed && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] backdrop-blur-xl motion-reduce:transition-none" role="status" aria-live="polite" aria-label={windowStateMessage} style={{ transition: windowTransition }}>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-status-red/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-signal-500/90" />
            </div>
            <span className="min-w-0 max-w-full break-words text-sm font-semibold text-slate-700 dark:text-slate-300">
              {session.sprintName}
            </span>
            <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] flex items-center gap-1.5 ${statusTone[session.status]}`}>
              {session.status === 'starting' ? <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" /> : session.status === 'running' ? <Play className="w-3 h-3" fill="currentColor" /> : session.status === 'error' ? <AlertCircle className="w-3 h-3" /> : <Square className="w-3 h-3" fill="currentColor" />}
              {statusLabel[session.status]}
            </div>
          </div>
          <button
            ref={restoreButtonRef}
            type="button"
            onClick={() => setWindowState("normal")}
            aria-label={t("restorePreviewWindow")}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
            style={{ transition: controlTransition }}
          >
            <Maximize2 className="h-3 w-3" strokeWidth={2.5} />
            {t("restore")}
          </button>
        </div>
      )}

      {/* Closed state presentation */}
      {isClosed && !isFullscreen && !isMinimized && (
        <div className="mb-5 overflow-hidden rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] shadow-[var(--elevation-base)] backdrop-blur-xl motion-reduce:transition-none" role="status" aria-live="polite" aria-label={windowStateMessage} style={{ transition: windowTransition }}>
          <div className="relative flex h-[calc(100vh-23rem)] min-h-[540px] flex-col items-center justify-center bg-slate-100/70 px-8 text-center dark:bg-void-950">
            <div className="h-12 w-12 rounded-full border border-black/[0.08] flex items-center justify-center mb-4 dark:border-white/[0.08]">
              <X className="h-5 w-5 text-slate-400" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t("windowClosed")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("windowClosedDescription")}
            </p>
            <button
              ref={reopenButtonRef}
              type="button"
              aria-label={t("reopenPreviewWindow")}
              onClick={() => setWindowState("normal")}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-2xl border border-black/[0.08] px-4 text-sm font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
              style={{ transition: controlTransition }}
            >
              {t("reopenWindow")}
            </button>
          </div>
        </div>
      )}

      {/* Active window chrome and hidden iframe container */}
      <div
        aria-hidden={isMinimized || isClosed ? "true" : undefined}
        className={
          isMinimized || isClosed
            ? "hidden"
            : isFullscreen
              ? "flex flex-col h-full w-full"
              : "overflow-hidden rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] shadow-[var(--elevation-base)] backdrop-blur-xl"
        }
      >
        <div className="border-b border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-3">
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {windowStateMessage}
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                ref={closeButtonRef}
                type="button"
                title={t("closeWindow")}
                aria-label={t("closePreviewWindow")}
                onClick={() => {
                  rememberChromeControl(closeButtonRef.current);
                  setWindowState("closed");
                }}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-status-red/80 transition hover:bg-status-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/50 motion-reduce:transition-none"
              style={{ transition: controlTransition }}
            >
              <X className="h-2 w-2 text-red-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              ref={minimizeButtonRef}
              type="button"
              title={t("minimizeWindow")}
              aria-label={t("minimizePreviewWindow")}
              onClick={() => {
                rememberChromeControl(minimizeButtonRef.current);
                setWindowState("minimized");
              }}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-amber-400/80 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 motion-reduce:transition-none"
              style={{ transition: controlTransition }}
            >
              <Minus className="h-2 w-2 text-amber-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              ref={fullscreenButtonRef}
              type="button"
              title={isFullscreen ? t("restoreWindow") : t("maximizeWindow")}
              aria-label={isFullscreen ? t("restorePreviewWindow") : t("enterPreviewFullscreen")}
              onClick={() => {
                rememberChromeControl(fullscreenButtonRef.current);
                setWindowState(isFullscreen ? "normal" : "fullscreen");
              }}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-signal-500/90 transition hover:bg-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none"
              style={{ transition: controlTransition }}
            >
              {isFullscreen ? (
                <Minimize2 className="h-2 w-2 text-green-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              ) : (
                <Maximize2 className="h-2 w-2 text-green-900 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              )}
            </button>
          </div>
          <div className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] flex items-center gap-1.5 ${statusTone[session.status]}`}>
            {session.status === 'starting' ? <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" /> : session.status === 'running' ? <Play className="w-3 h-3" fill="currentColor" /> : session.status === 'error' ? <AlertCircle className="w-3 h-3" /> : <Square className="w-3 h-3" fill="currentColor" />}
            {statusLabel[session.status]}
          </div>
        </div>
        {visiblePortMappings.length > 0 && (
          <div
            role="tablist"
            aria-label={t("previewPortsFor", { name: sessionName })}
            aria-busy={navigationBusy}
            className="mt-3 flex min-w-0 gap-1 overflow-x-auto rounded-2xl border border-black/[0.06] bg-slate-100/70 p-1 dark:border-white/[0.06] dark:bg-void-950/50"
          >
            {visiblePortMappings.map((mapping, index) => {
              const selected = mapping.containerPort === selectedContainerPort;
              const label = formatPreviewPortTabLabel(mapping);
              const routeLabel = mapping.hostPort
                ? t("routeToHostPort", { label, port: mapping.hostPort })
                : t("routeWaitingHostPort", { label });
              return (
                <button
                  key={mapping.containerPort}
                  ref={(element) => {
                    portTabRefs.current[mapping.containerPort] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={t("selectPreviewPort", { route: routeLabel })}
                  aria-controls="preview-window-frame"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectPortTab(mapping)}
                  onKeyDown={(event) => handlePortTabKeyDown(event as KeyboardEvent, index)}
                  className={`inline-flex h-8 shrink-0 items-center rounded-xl px-3 font-mono text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none ${
                    selected
                      ? "bg-white text-slate-900 shadow-sm dark:bg-white/[0.1] dark:text-white"
                      : "text-slate-500 hover:bg-white/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
                  }`}
                  style={{ transition: controlTransition }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {navigationAnnouncement}
        </div>
        <p id={containerDescriptionId} className="sr-only">
          {navigationDescription}
        </p>
        <p id={navigationPendingDescriptionId} className="sr-only">
          {navigationDescription}
        </p>
        <div className="flex flex-wrap items-center gap-2" aria-describedby={controlsDisabled ? disabledDescriptionId : undefined} aria-busy={navigationBusy}>
          <button
            type="button"
            onClick={() => {
              announceNavigation(controlsDisabled ? navigationDescription : t("goingBack"));
              if (!controlsDisabled) {
                onNavigateBack();
              }
            }}
            disabled={controlsDisabled}
            aria-disabled={controlsDisabled}
            aria-busy={navigationBusy || (!navigationEnabled && session?.status === 'starting')}
            aria-label={t("goBackForSession", { name: sessionName })}
            aria-describedby={controlsDisabled ? disabledDescriptionId : undefined}
            title={controlsDisabled ? navigationDescription : t("goBack")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
            style={{ transition: controlTransition }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => {
              announceNavigation(controlsDisabled ? navigationDescription : t("goingForward"));
              if (!controlsDisabled) {
                onNavigateForward();
              }
            }}
            disabled={controlsDisabled}
            aria-disabled={controlsDisabled}
            aria-busy={navigationBusy || (!navigationEnabled && session?.status === 'starting')}
            aria-label={t("goForwardForSession", { name: sessionName })}
            aria-describedby={controlsDisabled ? disabledDescriptionId : undefined}
            title={controlsDisabled ? navigationDescription : t("goForward")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
            style={{ transition: controlTransition }}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => {
              announceNavigation(controlsDisabled ? navigationDescription : t("reloadingPreview"));
              if (!controlsDisabled) {
                onReload();
              }
            }}
            disabled={controlsDisabled}
            aria-disabled={controlsDisabled}
            aria-busy={navigationBusy || (!navigationEnabled && session?.status === 'starting')}
            aria-label={t("reloadForSession", { name: sessionName, path: normalizedPath })}
            aria-describedby={controlsDisabled ? disabledDescriptionId : undefined}
            title={controlsDisabled ? navigationDescription : t("reloadPreview")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
            style={{ transition: controlTransition }}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <form
            className="flex min-w-0 flex-1 items-center"
            onSubmit={(event) => {
              event.preventDefault();
              announceNavigation(controlsDisabled ? navigationDescription : t("navigatingToPath", { path: addressValue }));
              if (!controlsDisabled) {
                onAddressSubmit(addressValue);
              }
            }}
          >
            <label id={addressLabelId} className="sr-only" htmlFor="preview-address-input">
              {t("previewAddressFor", { name: sessionName })}
            </label>
            <input
              id="preview-address-input"
              value={addressValue}
              onInput={(event) => onAddressChange((event.currentTarget as HTMLInputElement).value)}
              disabled={controlsDisabled}
              aria-disabled={controlsDisabled}
              aria-busy={navigationBusy || (!navigationEnabled && session?.status === 'starting')}
              aria-label={t("previewAddressFor", { name: sessionName })}
              aria-describedby={controlsDisabled ? disabledDescriptionId : undefined}
              title={controlsDisabled ? navigationDescription : t("previewAddress")}
              placeholder={controlsDisabled ? t("navigationUnavailablePlaceholder") : t("enterPath")}
              className="h-10 w-full rounded-2xl border border-black/[0.08] bg-white/80 px-4 font-mono text-sm text-slate-800 outline-none transition focus:border-signal-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100"
              style={{ transition: controlTransition }}
            />
          </form>
        </div>
        {controlsDisabled && (
          <div className="mt-2 rounded-2xl border border-slate-400/20 bg-slate-500/10 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-300">
            {navigationDescription}
          </div>
        )}
      </div>
      <div
        id="preview-window-frame"
        className={
          isFullscreen
            ? "flex-1 bg-slate-100/70 dark:bg-void-950"
            : "relative h-[calc(100vh-23rem)] min-h-[540px] bg-slate-100/70 dark:bg-void-950"
        }
      >
        {children}
      </div>
      </div>
    </div>
  );
};
