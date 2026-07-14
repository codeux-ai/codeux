import type { FunctionComponent, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Copy, Download, Minus, Square, X } from "lucide-preact";
import { RobotLogo } from "./brand/RobotLogo.js";
import { useUpdateStatus } from "../hooks/use-update-status.js";
import { useOptionalDashboardI18n } from "../i18n/context.js";
import { shellMessages } from "../i18n/messages/shell.js";

declare const __APP_VERSION__: string;

type Platform = "darwin" | "win32" | "linux" | "other";

const resolvePlatform = (raw?: string): Platform => {
  if (raw === "darwin" || raw === "win32" || raw === "linux") return raw;
  return "other";
};

interface TitleBarProps {
  appearanceVariant?: "default" | "translucent";
}

export const TitleBar: FunctionComponent<TitleBarProps> = ({ appearanceVariant = "translucent" }) => {
  const { translate } = useOptionalDashboardI18n();
  const desktop = typeof window !== "undefined" ? window.codeUxDesktop : undefined;
  const windowApi = desktop?.window;
  const [platform, setPlatform] = useState<Platform>(() => resolvePlatform(desktop?.platform));
  const [isMaximized, setIsMaximized] = useState(false);
  const { updateAvailable, latestVersion } = useUpdateStatus();

  useEffect(() => {
    if (!windowApi) return;
    let cancelled = false;
    void windowApi.getState().then((state) => {
      if (cancelled) return;
      setIsMaximized(state.isMaximized);
      setPlatform(resolvePlatform(state.platform));
    });
    const off = windowApi.onStateChange((state) => {
      setIsMaximized(state.isMaximized);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [windowApi]);

  if (!windowApi) return null;

  const isMac = platform === "darwin";
  const stopTitleBarDoubleClick: JSX.MouseEventHandler<HTMLElement> = (event) => {
    event.stopPropagation();
  };

  const toggleMaximize = async (): Promise<void> => {
    const nextIsMaximized = await windowApi.toggleMaximize();
    setIsMaximized(nextIsMaximized);
  };

  const handleUpdateClick: JSX.MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    void desktop?.openUpdates?.();
  };
  const updateLabel = latestVersion
    ? translate(shellMessages, "titlebarUpdateAvailable", { version: latestVersion })
    : translate(shellMessages, "titlebarOpenUpdates");

  const controls = isMac ? null : (
    <div className="flex items-stretch h-full titlebar-no-drag">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void windowApi.minimize();
        }}
        onDblClick={stopTitleBarDoubleClick}
        aria-label={translate(shellMessages, "minimizeWindow")}
        className="titlebar-no-drag h-full w-11 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:bg-black/[0.06] dark:focus-visible:bg-white/[0.06]"
      >
        <Minus aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void toggleMaximize();
        }}
        onDblClick={stopTitleBarDoubleClick}
        aria-label={translate(shellMessages, isMaximized ? "restoreWindow" : "maximizeWindow")}
        className="titlebar-no-drag h-full w-11 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:bg-black/[0.06] dark:focus-visible:bg-white/[0.06]"
      >
        {isMaximized ? (
          <Copy aria-hidden="true" className="w-3 h-3 -scale-x-100" strokeWidth={1.75} />
        ) : (
          <Square aria-hidden="true" className="w-3 h-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void windowApi.close();
        }}
        onDblClick={stopTitleBarDoubleClick}
        aria-label={translate(shellMessages, "closeWindow")}
        className="titlebar-no-drag h-full w-11 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-white hover:bg-[#E81123] focus:outline-none focus-visible:bg-[#E81123] focus-visible:text-white transition-colors"
      >
        <X aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );

  const trafficLightSpacer = isMac ? <div aria-hidden="true" className="w-[72px] shrink-0" /> : null;

  const bgClass = appearanceVariant === "translucent"
    ? "bg-[#F9F8F4]/88 dark:bg-void-900/88 backdrop-blur-md"
    : "bg-[#F9F8F4] dark:bg-void-900";

  const handleDoubleClick = () => {
    void toggleMaximize();
  };

  return (
    <div
      data-titlebar="codeux"
      onDblClick={handleDoubleClick}
      className={`titlebar-drag relative z-[60] flex items-center h-9 w-full ${bgClass} border-b border-black/[0.04] dark:border-white/[0.04] select-none`}
    >
      {trafficLightSpacer}
      <div className="flex items-center gap-2 px-3 h-full flex-1 min-w-0">
        <div className="w-4 h-4 rounded-md overflow-hidden ring-1 ring-inset ring-white/[0.08] shadow-[0_0_10px_rgba(0,224,160,0.25)] shrink-0">
          <RobotLogo size={16} rounded={false} />
        </div>
        <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-600 dark:text-slate-300 truncate">
          Code<span className="text-signal-500">UX</span>
          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
          <span className="text-slate-400 dark:text-slate-500 font-medium">
            v{__APP_VERSION__}
          </span>
        </span>
        {updateAvailable ? (
          <button
            type="button"
            onClick={handleUpdateClick}
            onDblClick={stopTitleBarDoubleClick}
            aria-label={updateLabel}
            title={updateLabel}
            className="titlebar-no-drag inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 transition-colors hover:border-amber-500/35 hover:bg-amber-500/15 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-400 dark:hover:border-amber-300/35 dark:hover:bg-amber-400/15 dark:hover:text-amber-300"
          >
            <Download aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
            {translate(shellMessages, "titlebarUpdate")}
          </button>
        ) : null}
      </div>
      {controls}
    </div>
  );
};
