import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { AlertCircle, Check, ClipboardPaste, RefreshCw, Terminal, X } from "lucide-preact";
import { useInteractiveLoginSession } from "../../hooks/useInteractiveLoginSession.js";
import { restoreFocusSafely } from "../../hooks/use-focus-trap.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import { TerminalOutputBuffer } from "../../lib/terminal-output-buffer.js";
import type { ContainerBuildProgress } from "../../../lib/activity.js";
import { ContainerBuildStatusInfobox } from "../live-session/ContainerBuildStatusInfobox.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../i18n/messages/settings-integrations.js";

interface TerminalLoginModalProps {
  providerConfigId: string;
  providerId: string;
  providerName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const renderTerminalContentWithLinks = (text: string) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (/^https?:\/\//u.test(part)) {
      let cleanUrl = part;
      let trailing = "";
      const match = part.match(/([),."';]+)$/);
      if (match) {
        cleanUrl = part.slice(0, -match[0].length);
        trailing = match[0];
      }
      return (
        <span key={index}>
          <a 
            href={getSafeUrl(cleanUrl)}
            target="_blank" 
            rel="noopener noreferrer" 
            className="cursor-pointer select-text font-semibold text-white underline decoration-signal-300 underline-offset-2 hover:text-signal-100"
            onClick={(e) => e.stopPropagation()}
          >
            {cleanUrl}
          </a>
          {trailing}
        </span>
      );
    }
    return part;
  });
};

export const TerminalLoginModal: FunctionComponent<TerminalLoginModalProps> = ({
  providerConfigId,
  providerId,
  providerName,
  onClose,
  onSuccess,
}) => {
  const { translate: t } = useDashboardI18n();
  const [status, setStatus] = useState<"connecting" | "active" | "exited" | "error">("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [detectedLoginUrl, setDetectedLoginUrl] = useState<string | null>(null);
  const [containerBuildProgress, setContainerBuildProgress] = useState<ContainerBuildProgress | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const terminalBufferRef = useRef<TerminalOutputBuffer | null>(null);
  const hasOpenedUrlRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogTitleId = `terminal-login-title-${providerConfigId.replace(/\W/g, "-")}`;
  const terminalRegionLabel = providerName + t(settingsIntegrationsMessages, "terminalOutputMiddle") + providerConfigId;

  // Close context menu on any global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusSafely(triggerRef.current);
  }, []);

  if (!terminalBufferRef.current) {
    terminalBufferRef.current = new TerminalOutputBuffer();
  }

  const focusTerminal = () => {
    hiddenInputRef.current?.focus({ preventScroll: true });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusTerminal();
    setPasteFeedback(null);
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 216)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 64)),
    });
  };

  const processChunk = (chunk: string) => {
    const outputText = terminalBufferRef.current?.write(chunk) ?? "";
    setTerminalOutput(outputText);

    // Scan for container browser redirect URL
    const match = outputText.match(/\[CONTAINER_OPEN_URL\]:\s*(https?:\/\/[^\s\]]+)/);
    if (match && match[1]) {
      let url = match[1].trim();
      url = url.replace(/[)\s\x1b]+$/u, "");
      
      setDetectedLoginUrl(url);
      
      if (hasOpenedUrlRef.current !== url) {
        hasOpenedUrlRef.current = url;
        try {
          window.open(url, "_blank");
        } catch (e) {
          // Ignore popup blocker errors
        }
      }
    }
  };

  const sendTerminalInput = (data: string): boolean => {
    if (!data || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }
    wsRef.current.send(JSON.stringify({ type: "input", data }));
    return true;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    let rawKey = "";
    if (e.key === "Enter") {
      rawKey = "\r";
    } else if (e.key === "Backspace") {
      rawKey = "\x7f";
    } else if (e.key === "Tab") {
      e.preventDefault();
      rawKey = "\t";
    } else if (e.key === "Escape") {
      rawKey = "\x1b";
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rawKey = "\x1b[A";
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      rawKey = "\x1b[B";
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      rawKey = "\x1b[C";
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      rawKey = "\x1b[D";
    } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      rawKey = "\x03";
    } else if (e.ctrlKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      rawKey = "\x04";
    }

    if (rawKey) {
      sendTerminalInput(rawKey);
      if (hiddenInputRef.current) {
        hiddenInputRef.current.value = "";
      }
    }
  };

  const handleTextAreaInput = (e: Event) => {
    const input = e.currentTarget as HTMLTextAreaElement;
    sendTerminalInput(input.value);
    input.value = "";
  };

  const pasteClipboardText = async (): Promise<void> => {
    setContextMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setPasteFeedback({ kind: "error", message: t(settingsIntegrationsMessages, "clipboardEmpty") });
        return;
      }
      if (!sendTerminalInput(text)) {
        setPasteFeedback({ kind: "error", message: t(settingsIntegrationsMessages, "terminalNotReady") });
        return;
      }
      setPasteFeedback({ kind: "success", message: t(settingsIntegrationsMessages, "clipboardPasted") });
    } catch {
      setPasteFeedback({ kind: "error", message: t(settingsIntegrationsMessages, "clipboardBlocked") });
    } finally {
      focusTerminal();
    }
  };

  const interactiveSession = useInteractiveLoginSession({
    providerConfigId,
    providerId,
    onSessionMessage: (msg) => {
      if (msg.type === "output" && typeof msg.data === "string") {
        processChunk(msg.data);
      } else if (msg.type === "login_url" && typeof msg.url === "string") {
        const url = msg.url.trim();
        setDetectedLoginUrl(url);
        if (hasOpenedUrlRef.current !== url) {
          hasOpenedUrlRef.current = url;
          try {
            window.open(url, "_blank");
          } catch (e) {
            // Ignore popup blocker errors
          }
        }
      } else if (msg.type === "exit" && typeof msg.code === "number") {
        setStatus("exited");
        setExitCode(msg.code);
        if (msg.code === 0 && onSuccess) {
          onSuccess();
        }
      }
    },
    onSessionError: (message) => {
      setStatus("error");
      setErrorMessage(message);
    },
    onBuildProgress: setContainerBuildProgress,
  });

  useEffect(() => {
    wsRef.current = interactiveSession.websocket;
    setStatus(interactiveSession.status);
    if (interactiveSession.status === "active") {
      const focusTimer = window.setTimeout(focusTerminal, 200);
      return () => window.clearTimeout(focusTimer);
    }
    return undefined;
  }, [interactiveSession.status, interactiveSession.websocket]);

  // Scroll to bottom on output update
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ block: "end" });
  }, [terminalOutput]);

  const modalContent = (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-void-900/70 p-3 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby="terminal-login-status terminal-login-help"
        className="relative flex h-[min(680px,calc(100dvh-1.5rem))] w-[min(920px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-void-950 shadow-[var(--elevation-floating)] outline-none"
      >
        <p id="terminal-login-help" className="sr-only">
          {t(settingsIntegrationsMessages, "terminalHelp")}
        </p>
        {/* Glow Effects */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/30 to-transparent" />

        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] bg-void-900/90 px-4 py-3.5 text-slate-100 backdrop-blur-md sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-500/10 text-signal-400">
              <Terminal aria-hidden="true" className="h-4 w-4" />
            </div>
            <div>
              <h3 id={dialogTitleId} className="text-sm font-semibold text-white">{t(settingsIntegrationsMessages, "loginTo")}{providerName}</h3>
              <p className="text-[11px] text-slate-400 font-mono">{t(settingsIntegrationsMessages, "instance")} {providerConfigId}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status === "connecting" && (
              <div id="terminal-login-status" role="status" aria-live="polite" className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
                <RefreshCw aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
                {t(settingsIntegrationsMessages, "bootingContainer")}
              </div>
            )}
            {status === "active" && (
              <div id="terminal-login-status" role="status" aria-live="polite" className="flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 text-[10px] font-semibold text-signal-300">
                <div aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal-400 motion-safe:animate-pulse" />
                {t(settingsIntegrationsMessages, "activeSession")}
              </div>
            )}
            {status === "exited" && (
              <div id="terminal-login-status" role={exitCode === 0 ? "status" : "alert"} aria-live={exitCode === 0 ? "polite" : "assertive"} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold border ${
                exitCode === 0 
                  ? "border-status-green/20 bg-status-green/10 text-status-green" 
                  : "border-status-red/20 bg-status-red/10 text-status-red"
              }`}>
                {exitCode === 0 ? <Check aria-hidden="true" className="h-3 w-3" /> : <AlertCircle aria-hidden="true" className="h-3 w-3" />}
                {exitCode === 0 ? t(settingsIntegrationsMessages, "successful") : `${t(settingsIntegrationsMessages, "exited")} (${exitCode})`}
              </div>
            )}
            {status === "error" && (
              <div id="terminal-login-status" role="alert" aria-live="assertive" className="flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-2.5 py-1 text-[10px] font-semibold text-status-red">
                <AlertCircle aria-hidden="true" className="h-3 w-3" />
                {t(settingsIntegrationsMessages, "connectionError")}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label={t(settingsIntegrationsMessages, "closeTerminalPrefix") + providerName + t(settingsIntegrationsMessages, "closeTerminalSuffix")}
              className="rounded-full p-2 text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-void-900"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Content - The Terminal Screen */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-void-950 p-4 font-mono text-sm leading-relaxed text-white sm:p-6">
          <ContainerBuildStatusInfobox progress={containerBuildProgress} className="mb-4 shrink-0" />

          {status === "connecting" && (
            <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-void-950/80 p-6">
              <RefreshCw aria-hidden="true" className="h-8 w-8 text-signal-400 motion-safe:animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold text-white">{t(settingsIntegrationsMessages, "startingDocker")}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t(settingsIntegrationsMessages, containerBuildProgress ? "preparingLoginImage" : "mountingCredentials")}
                </p>
              </div>
              {containerBuildProgress && (
                <ContainerBuildStatusInfobox progress={containerBuildProgress} className="w-full max-w-xl text-left" />
              )}
            </div>
          )}

          {status === "error" && (
            <div role="alert" aria-live="assertive" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-void-950/80 p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-red/10 text-status-red">
                <AlertCircle aria-hidden="true" className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">{t(settingsIntegrationsMessages, "failedContainerConnection")}</p>
                <p className="mt-2 rounded-lg bg-white/5 px-4 py-2 text-xs text-slate-400 max-w-md break-words font-mono border border-white/5">{errorMessage}</p>
              </div>
              <button 
                type="button"
                onClick={onClose}
                className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white shadow-[var(--elevation-raised)] hover:bg-white/20 transition-colors"
              >
                {t(settingsIntegrationsMessages, "closeWindow")}
              </button>
            </div>
          )}

          {/* Terminal output console */}
          <div 
            role="log"
            aria-label={terminalRegionLabel}
            aria-describedby="terminal-login-help"
            aria-live="polite"
            aria-relevant="additions text"
            tabIndex={0}
            onClick={focusTerminal}
            onFocus={focusTerminal}
            onContextMenu={handleContextMenu}
            className="relative min-h-0 flex-1 cursor-text select-text overflow-auto rounded-xl border border-white/[0.12] bg-black/80 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none scrollbar-thin scrollbar-thumb-white/15 focus-within:border-signal-400/70 focus-within:ring-2 focus-within:ring-signal-400/35 focus-within:ring-offset-2 focus-within:ring-offset-void-950"
          >
            {/* Hidden textarea to capture keystrokes and paste operations */}
            <textarea
              ref={hiddenInputRef}
              aria-label={providerName + t(settingsIntegrationsMessages, "terminalInputMiddle") + providerConfigId}
              onKeyDown={handleKeyDown}
              onInput={handleTextAreaInput}
              tabIndex={-1}
              className="pointer-events-none absolute h-px w-px opacity-0"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellcheck={false}
            />

            {terminalOutput ? (
              <pre data-testid="terminal-login-output" className="min-w-max whitespace-pre font-mono text-xs leading-5 text-white selection:bg-signal-400/30 selection:text-white">
                {renderTerminalContentWithLinks(terminalOutput)}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-600 italic select-none">
                {t(settingsIntegrationsMessages, "awaitingTerminal")}
              </div>
            )}
            <div ref={terminalEndRef} />
          </div>

          {pasteFeedback && (
            <div
              role={pasteFeedback.kind === "error" ? "alert" : "status"}
              aria-live={pasteFeedback.kind === "error" ? "assertive" : "polite"}
              className={`mt-3 shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold ${
                pasteFeedback.kind === "error"
                  ? "border-status-red/25 bg-status-red/[0.08] text-red-200"
                  : "border-signal-400/25 bg-signal-400/[0.08] text-signal-100"
              }`}
            >
              {pasteFeedback.message}
            </div>
          )}

          {detectedLoginUrl && status === "active" && (
            <div role="status" aria-live="polite" className="mt-4 shrink-0 rounded-2xl border border-signal-500/30 bg-signal-500/5 p-4 backdrop-blur-sm transition-all duration-300">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-500/10 text-signal-400">
                    <Terminal aria-hidden="true" className="h-5 w-5 motion-safe:animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">{t(settingsIntegrationsMessages, "browserAuthRequested")}</h4>
                    <p className="mt-1 text-[11px] text-slate-400 leading-normal">
                      {providerName}{t(settingsIntegrationsMessages, "waitingForAuthSuffix")}
                    </p>
                  </div>
                </div>
                <a
                  href={getSafeUrl(detectedLoginUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-signal-500 px-4 py-2.5 text-xs font-bold text-white dark:text-void-950 hover:bg-signal-400 transition-all duration-200 shadow-[var(--elevation-raised)] cursor-pointer"
                >
                  {t(settingsIntegrationsMessages, "authorize")}{providerName}
                </a>
              </div>
            </div>
          )}

          {/* Sleek status hint */}
          {status === "active" && (
            <div className="mt-3 flex shrink-0 flex-col gap-1 text-[10px] font-mono text-slate-400 select-none sm:flex-row sm:items-center sm:justify-between">
              <span>{t(settingsIntegrationsMessages, "terminalInputHelp")}</span>
              <span className="shrink-0 font-semibold text-signal-300"><span aria-hidden="true">●</span> {t(settingsIntegrationsMessages, "interactiveReady")}</span>
            </div>
          )}

          {status === "exited" && (
            <div role={exitCode === 0 ? "status" : "alert"} aria-live={exitCode === 0 ? "polite" : "assertive"} className="mt-4 shrink-0 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
              <p className="text-xs text-slate-400 font-semibold">
                {exitCode === 0 
                  ? t(settingsIntegrationsMessages, "loginSuccess")
                  : t(settingsIntegrationsMessages, "loginExitedPrefix") + exitCode + t(settingsIntegrationsMessages, "loginExitedSuffix")
                }
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 inline-flex items-center justify-center rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-white dark:text-void-950 hover:bg-signal-400 transition-colors"
              >
                {t(settingsIntegrationsMessages, "done")}
              </button>
            </div>
          )}
        </div>

        {contextMenu && (
          <div
            role="menu"
            aria-label={providerName + t(settingsIntegrationsMessages, "terminalActionsMiddle")}
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
            className="fixed z-[9999] min-w-[200px] overflow-hidden rounded-xl border border-white/[0.12] bg-void-900 p-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pasteClipboardText()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              <ClipboardPaste aria-hidden="true" className="h-4 w-4 text-signal-300" />
              {t(settingsIntegrationsMessages, "pasteClipboard")}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modalContent, document.body);
};
