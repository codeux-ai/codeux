import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import gsap from 'gsap';
import { X } from 'lucide-preact';
import type {
  ProjectExecutionStatsSnapshot,
  ProjectStatsWindow,
} from '../../../types.js';
import {
  CHIP_CLASS,
  INPUT_CLASS,
} from './StatsShared.js';
import styles from './UsageFilterMenu.module.css';

interface UsageFilterMenuProps {
  isOpen: boolean;
  onClose: () => void;
  activeWindow: ProjectStatsWindow | string;
  customFrom: string;
  customTo: string;
  onSelectPreset: (value: Exclude<ProjectStatsWindow, "custom">) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
  stats: ProjectExecutionStatsSnapshot | null;
  enabledSeries: Record<string, boolean>;
  setEnabledSeries: (val: Record<string, boolean> | ((curr: Record<string, boolean>) => Record<string, boolean>)) => void;
}

export const UsageFilterMenu: FunctionComponent<UsageFilterMenuProps> = ({
  isOpen,
  onClose,
  activeWindow,
  customFrom,
  customTo,
  onSelectPreset,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
  stats,
  enabledSeries,
  setEnabledSeries,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;

    if (isOpen) {
      gsap.fromTo(
        menuRef.current,
        { opacity: 0, scale: 0.95, y: -10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'power2.out' }
      );
      // Focus the close button when opened for keyboard support
      closeButtonRef.current?.focus();
    } else {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        y: -10,
        duration: 0.2,
        ease: 'power2.in',
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen && !menuRef.current) return null;

  const activeSeriesCount = Object.values(enabledSeries).filter(Boolean).length;

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ display: isOpen || (menuRef.current && gsap.getProperty(menuRef.current, 'opacity') as number > 0) ? 'block' : 'none' }}
    >
      <div className={styles.content}>
        <div className={`${styles.header} flex items-center justify-between`}>
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 dark:text-white">
            Graph Filters
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/[0.05] dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Time Window</label>
          <div className="flex flex-wrap gap-2">
            {(['24h', '7d', '30d', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSelectPreset(value)}
                className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all ${
                  activeWindow === value
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-void-900'
                    : 'bg-black/[0.04] text-slate-500 hover:bg-black/[0.08] dark:bg-white/[0.04] dark:text-slate-400'
                }`}
              >
                {value === 'all' ? 'All time' : value}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Custom Range</label>
          <div className="grid gap-2">
            <input
              type="date"
              value={customFrom}
              onInput={(e) => onCustomFromChange((e.currentTarget as HTMLInputElement).value)}
              className={`${INPUT_CLASS} !h-9 !px-3 !text-[12px]`}
            />
            <input
              type="date"
              value={customTo}
              onInput={(e) => onCustomToChange((e.currentTarget as HTMLInputElement).value)}
              className={`${INPUT_CLASS} !h-9 !px-3 !text-[12px]`}
            />
            <button
              type="button"
              onClick={onApplyCustom}
              className="mt-1 flex h-9 items-center justify-center rounded-xl bg-slate-900 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-transform hover:-translate-y-0.5 dark:bg-white dark:text-void-900"
            >
              Apply Range
            </button>
          </div>
        </div>

        {stats && (
          <div className={styles.section}>
            <label className={styles.label}>Metric Series</label>
            <div className="flex flex-col gap-2">
              {stats.chartSeries.map((s) => {
                const active = enabledSeries[s.id] || false;
                const disabled = activeSeriesCount === 1 && active;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (activeSeriesCount === 1 && enabledSeries[s.id]) return;
                      setEnabledSeries((curr) => ({ ...curr, [s.id]: !curr[s.id] }));
                    }}
                    disabled={disabled}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all ${
                      active
                        ? 'border-signal-500/20 bg-signal-500/[0.03] text-slate-900 dark:text-white'
                        : 'border-black/[0.05] bg-transparent text-slate-500 hover:border-black/[0.1] dark:border-white/[0.05] dark:text-slate-400'
                    } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color || '#ccc' }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                        {s.label}
                      </span>
                    </div>
                    {active && (
                      <div className="h-1.5 w-1.5 rounded-full bg-signal-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
