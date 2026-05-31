import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { Sun, Moon } from "lucide-preact";
import { Tooltip } from "../ui/Tooltip.js";

interface UserMenuProps {
    isDark: boolean;
    toggleTheme: () => void;
}

export const UserMenu: FunctionComponent<UserMenuProps> = memo(({ isDark, toggleTheme }) => {
    return (
        <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
            <button
                onClick={toggleTheme}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
                {isDark
                    ? <Sun aria-hidden="true" className="w-4 h-4 text-slate-400 hover:text-white transition-colors" strokeWidth={1.5} />
                    : <Moon aria-hidden="true" className="w-4 h-4 text-slate-500 hover:text-slate-900 transition-colors" strokeWidth={1.5} />
                }
            </button>
        </Tooltip>
    );
});
