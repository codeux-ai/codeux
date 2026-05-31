import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertCircle, Check, RefreshCw, Terminal, X } from "lucide-preact";
import { useInteractiveLoginSession } from "../../hooks/useInteractiveLoginSession.js";

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
    if (urlRegex.test(part)) {
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
            href={cleanUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="underline text-signal-300 hover:text-signal-200 cursor-pointer select-text font-bold"
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
  const [status, setStatus] = useState<"connecting" | "active" | "exited" | "error">("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [detectedLoginUrl, setDetectedLoginUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const hasOpenedUrlRef = useRef<string | null>(null);

  // Close context menu on any global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Simulated infinite scrollback terminal buffer state
  const linesRef = useRef<string[]>([""]);
  const cursorRef = useRef<{ row: number; col: number }>({ row: 0, col: 0 });
  const savedCursorRef = useRef<{ row: number; col: number }>({ row: 0, col: 0 });

  const processChunk = (chunk: string) => {
    let lines = [...linesRef.current];
    let cursor = { ...cursorRef.current };
    
    let i = 0;
    while (i < chunk.length) {
      const char = chunk[i];
      
      if (char === "\n") {
        cursor.row++;
        if (cursor.row >= lines.length) {
          lines.push("");
        }
        cursor.col = 0;
        i++;
      } else if (char === "\r") {
        cursor.col = 0;
        i++;
      } else if (char === "\x08" || char === "\x7f") {
        cursor.col = Math.max(0, cursor.col - 1);
        const currentLine = lines[cursor.row] || "";
        lines[cursor.row] = currentLine.slice(0, cursor.col) + currentLine.slice(cursor.col + 1);
        i++;
      } else if (char === "\t") {
        const spaces = "        ";
        const currentLine = lines[cursor.row] || "";
        lines[cursor.row] = currentLine.slice(0, cursor.col) + spaces + currentLine.slice(cursor.col);
        cursor.col += 8;
        i++;
      } else if (char === "\x1b") {
        if (chunk[i + 1] === "[") {
          let j = i + 2;
          let command = "";
          while (j < chunk.length && !/[a-zA-Z]/.test(chunk[j])) {
            command += chunk[j];
            j++;
          }
          if (j >= chunk.length) {
            break;
          }
          const action = chunk[j];
          const params = command.split(";").map(Number);
          
          if (action === "J") {
            const mode = params[0] || 0;
            if (mode === 0) {
              // Clear from cursor to end of screen
              lines[cursor.row] = (lines[cursor.row] || "").slice(0, cursor.col);
              for (let r = cursor.row + 1; r < lines.length; r++) {
                lines[r] = "";
              }
            } else if (mode === 1) {
              // Clear from start of screen to cursor
              lines[cursor.row] = " ".repeat(cursor.col) + (lines[cursor.row] || "").slice(cursor.col);
              for (let r = 0; r < cursor.row; r++) {
                lines[r] = "";
              }
            } else if (mode === 2 || mode === 3) {
              // Clear entire screen
              lines = [""];
              cursor.row = 0;
              cursor.col = 0;
            }
          } else if (action === "H" || action === "f") {
            const r = (params[0] || 1) - 1;
            const c = (params[1] || 1) - 1;
            cursor.row = r;
            while (cursor.row >= lines.length) {
              lines.push("");
            }
            cursor.col = c;
          } else if (action === "K") {
            const mode = params[0] || 0;
            const currentLine = lines[cursor.row] || "";
            if (mode === 0) {
              lines[cursor.row] = currentLine.slice(0, cursor.col);
            } else if (mode === 1) {
              lines[cursor.row] = " ".repeat(cursor.col) + currentLine.slice(cursor.col);
            } else if (mode === 2) {
              lines[cursor.row] = "";
            }
          } else if (action === "A") {
            const count = params[0] || 1;
            cursor.row = Math.max(0, cursor.row - count);
          } else if (action === "B") {
            const count = params[0] || 1;
            cursor.row = cursor.row + count;
            while (cursor.row >= lines.length) {
              lines.push("");
            }
          } else if (action === "C") {
            const count = params[0] || 1;
            cursor.col = cursor.col + count;
          } else if (action === "D") {
            const count = params[0] || 1;
            cursor.col = Math.max(0, cursor.col - count);
          } else if (action === "G") {
            // Cursor Horizontal Absolute (CHA)
            const col = (params[0] || 1) - 1;
            cursor.col = Math.max(0, col);
          } else if (action === "d") {
            // Vertical Line Position Absolute (VPA)
            const row = (params[0] || 1) - 1;
            cursor.row = Math.max(0, row);
            while (cursor.row >= lines.length) {
              lines.push("");
            }
          } else if (action === "E") {
            // Cursor Next Line (CNL)
            const count = params[0] || 1;
            cursor.row += count;
            cursor.col = 0;
            while (cursor.row >= lines.length) {
              lines.push("");
            }
          } else if (action === "F") {
            // Cursor Previous Line (CPL)
            const count = params[0] || 1;
            cursor.row = Math.max(0, cursor.row - count);
            cursor.col = 0;
          } else if (action === "s") {
            // Save cursor position (ANSI.SYS)
            savedCursorRef.current = { row: cursor.row, col: cursor.col };
          } else if (action === "u") {
            // Restore cursor position (ANSI.SYS)
            cursor.row = savedCursorRef.current.row;
            cursor.col = savedCursorRef.current.col;
            while (cursor.row >= lines.length) {
              lines.push("");
            }
          }
          
          i = j + 1;
        } else if (chunk[i + 1] === "7") {
          // Save cursor (DEC)
          savedCursorRef.current = { row: cursor.row, col: cursor.col };
          i += 2;
        } else if (chunk[i + 1] === "8") {
          // Restore cursor (DEC)
          cursor.row = savedCursorRef.current.row;
          cursor.col = savedCursorRef.current.col;
          while (cursor.row >= lines.length) {
            lines.push("");
          }
          i += 2;
        } else {
          i++;
        }
      } else {
        const code = char.charCodeAt(0);
        if (code >= 32) {
          const currentLine = lines[cursor.row] || "";
          let paddedLine = currentLine;
          if (cursor.col > currentLine.length) {
            paddedLine += " ".repeat(cursor.col - currentLine.length);
          }
          lines[cursor.row] = paddedLine.slice(0, cursor.col) + char + paddedLine.slice(cursor.col + 1);
          cursor.col++;
        }
        i++;
      }
    }

    // Limit scrollback buffer to 1000 lines to optimize performance
    if (lines.length > 1000) {
      const diff = lines.length - 1000;
      lines = lines.slice(diff);
      cursor.row = Math.max(0, cursor.row - diff);
    }
    
    linesRef.current = lines;
    cursorRef.current = cursor;
    
    // Format screen grid as clean lines and add cursor character ▊
    const renderedLines = lines.map((line, rIdx) => {
      const safeLine = line || "";
      if (rIdx === cursor.row) {
        const left = safeLine.slice(0, cursor.col);
        const cursorChar = "▊";
        const right = safeLine.slice(cursor.col + 1);
        return left + cursorChar + right;
      }
      return safeLine;
    });
    
    const outputText = renderedLines.join("\n");
    setTerminalOutput(outputText);

    // Scan for container browser redirect URL
    const match = outputText.match(/\[CONTAINER_OPEN_URL\]:\s*(https?:\/\/[^\s\]]+)/);
    if (match && match[1]) {
      let url = match[1].trim();
      // Remove any ANSI escape/color sequences
      url = url.replace(/\x1b\[[0-9;]*m/g, "");
      url = url.replace(/[)\s\x1b]+$/, ""); // strip trailing spaces, parens, or ESC chars
      
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
    } else if (e.ctrlKey && e.key === "c") {
      rawKey = "\x03";
    } else if (e.ctrlKey && e.key === "d") {
      rawKey = "\x04";
    }

    if (rawKey) {
      wsRef.current.send(JSON.stringify({ type: "input", data: rawKey }));
      if (hiddenInputRef.current) {
        hiddenInputRef.current.value = "";
      }
    }
  };

  const handleTextAreaInput = (e: any) => {
    const value = e.currentTarget.value;
    if (value && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data: value }));
    }
    e.currentTarget.value = "";
  };

  const focusTerminal = () => {
    hiddenInputRef.current?.focus();
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
  });

  useEffect(() => {
    wsRef.current = interactiveSession.websocket;
    setStatus(interactiveSession.status);
    if (interactiveSession.status === "active") {
      setTimeout(focusTerminal, 200);
    }
  }, [interactiveSession.status, interactiveSession.websocket]);

  // Scroll to bottom on output update
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalOutput]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative flex h-[600px] w-[800px] max-w-full flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-void-950 shadow-[0_24px_60px_rgba(0,0,0,0.8)] dark:bg-void-950">
        {/* Glow Effects */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/30 to-transparent" />

        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-void-900/60 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-500/10 text-signal-400">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Login to {providerName}</h3>
              <p className="text-[11px] text-slate-400 font-mono">Instance: {providerConfigId}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status === "connecting" && (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
                <RefreshCw className="h-3 w-3 animate-spin" />
                BOOTING CONTAINER
              </div>
            )}
            {status === "active" && (
              <div className="flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 text-[10px] font-semibold text-signal-300">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
                ACTIVE SESSION
              </div>
            )}
            {status === "exited" && (
              <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold border ${
                exitCode === 0 
                  ? "border-status-green/20 bg-status-green/10 text-status-green" 
                  : "border-status-red/20 bg-status-red/10 text-status-red"
              }`}>
                {exitCode === 0 ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {exitCode === 0 ? "SUCCESSFUL" : `EXITED (${exitCode})`}
              </div>
            )}
            {status === "error" && (
              <div className="flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-2.5 py-1 text-[10px] font-semibold text-status-red">
                <AlertCircle className="h-3 w-3" />
                CONNECTION ERROR
              </div>
            )}

            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Content - The Terminal Screen */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-void-950 p-6 font-mono text-sm leading-relaxed text-slate-300">
          {status === "connecting" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-void-950/80">
              <RefreshCw className="h-8 w-8 animate-spin text-signal-400" />
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Starting Docker Environment</p>
                <p className="mt-1 text-xs text-slate-500">Mounting host credential workspace...</p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-void-950/80 p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-red/10 text-status-red">
                <AlertCircle className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Failed to connect to container</p>
                <p className="mt-2 rounded-lg bg-white/5 px-4 py-2 text-xs text-slate-400 max-w-md break-words font-mono border border-white/5">{errorMessage}</p>
              </div>
              <button 
                onClick={onClose}
                className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
              >
                Close Window
              </button>
            </div>
          )}

          {/* Terminal output console */}
          <div 
            onClick={focusTerminal}
            onContextMenu={handleContextMenu}
            className="flex-1 overflow-y-auto rounded-xl border border-white/5 bg-black/40 p-4 scrollbar-thin scrollbar-thumb-white/10 cursor-text select-text focus-within:border-signal-500/50"
          >
            {/* Hidden textarea to capture keystrokes and paste operations */}
            <textarea
              ref={hiddenInputRef}
              onKeyDown={handleKeyDown}
              onInput={handleTextAreaInput}
              className="absolute h-0 w-0 opacity-0 pointer-events-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellcheck={false}
            />

            {terminalOutput ? (
              <pre className="whitespace-pre-wrap break-all text-xs text-emerald-400 font-mono select-text">
                {renderTerminalContentWithLinks(terminalOutput)}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-600 italic select-none">
                Awaiting terminal stream...
              </div>
            )}
            <div ref={terminalEndRef} />
          </div>

          {detectedLoginUrl && status === "active" && (
            <div className="mt-4 shrink-0 rounded-2xl border border-signal-500/30 bg-signal-500/5 p-4 backdrop-blur-sm transition-all duration-300">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-500/10 text-signal-400">
                    <Terminal className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Browser Authentication Requested</h4>
                    <p className="mt-1 text-[11px] text-slate-400 leading-normal">
                      {providerName} is waiting for authentication. Please log in using the button below.
                    </p>
                  </div>
                </div>
                <a
                  href={detectedLoginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-signal-500 px-4 py-2.5 text-xs font-bold text-void-950 hover:bg-signal-400 transition-all duration-200 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_4px_30px_rgba(0,224,160,0.4)] cursor-pointer"
                >
                  Authorize {providerName}
                </a>
              </div>
            </div>
          )}

          {/* Sleek status hint */}
          {status === "active" && (
            <div className="mt-3 flex shrink-0 items-center justify-between text-[10px] text-slate-500 font-mono select-none">
              <span>⌨ Click console to focus & type directly (supports arrow keys, Tab, backspaces, pasting tokens)</span>
              <span className="text-signal-400/80 animate-pulse font-semibold">● LIVE INTERACTIVE</span>
            </div>
          )}

          {status === "exited" && (
            <div className="mt-4 shrink-0 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
              <p className="text-xs text-slate-400 font-semibold">
                {exitCode === 0 
                  ? "🎉 Login process finished successfully! Credentials saved directly to your ~/.code-ux/credentials folder." 
                  : `⚠️ Login process exited with code ${exitCode}. Please try again.`
                }
              </p>
              <button
                onClick={onClose}
                className="mt-3 inline-flex items-center justify-center rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-void-950 hover:bg-signal-400 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {contextMenu && (
            <div 
              style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
              className="fixed z-[100] min-w-[160px] overflow-hidden rounded-xl border border-white/[0.08] bg-void-900 p-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={async () => {
                  setContextMenu(null);
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({ type: "input", data: text }));
                    }
                  } catch (err) {
                    // Fallback / ignore if blocked
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-white transition-colors"
              >
                📋 Paste Clipboard Text
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
