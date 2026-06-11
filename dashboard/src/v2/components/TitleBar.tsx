import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Minus, Square, Copy, X } from "lucide-preact";
import { RobotLogo } from "./brand/RobotLogo.js";

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
  const desktop = typeof window !== "undefined" ? window.codeUxDesktop : undefined;
  const windowApi = desktop?.window;
  const [platform, setPlatform] = useState<Platform>(() => resolvePlatform(desktop?.platform));
  const [isMaximized, setIsMaximized] = useState(false);

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

  const controls = isMac ? null : (
    <div className="flex items-stretch h-full titlebar-no-drag">
      <button
        type="button"
        onClick={() => void windowApi.minimize()}
        aria-label="Minimize window"
        className="h-full w-11 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:bg-black/[0.06] dark:focus-visible:bg-white/[0.06]"
      >
        <Minus aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => void windowApi.toggleMaximize()}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        className="h-full w-11 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:bg-black/[0.06] dark:focus-visible:bg-white/[0.06]"
      >
        {isMaximized ? (
          <Copy aria-hidden="true" className="w-3 h-3 -scale-x-100" strokeWidth={1.75} />
        ) : (
          <Square aria-hidden="true" className="w-3 h-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={() => void windowApi.close()}
        aria-label="Close window"
        className="h-full w-11 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-white hover:bg-[#E81123] focus:outline-none focus-visible:bg-[#E81123] focus-visible:text-white transition-colors"
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
    void windowApi.toggleMaximize();
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
          <span className="text-slate-400 dark:text-slate-500 font-medium">v{__APP_VERSION__}</span>
        </span>
      </div>
      {controls}
    </div>
  );
};
