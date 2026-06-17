import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import gsap from 'gsap';
import { X } from 'lucide-preact';
import type {
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import styles from './UsageFilterMenu.module.css';

interface UsageFilterMenuProps {
  isOpen: boolean;
  onClose: () => void;
  stats: ProjectExecutionStatsSnapshot | null;
  enabledSeries: Record<string, boolean>;
  setEnabledSeries: (val: Record<string, boolean> | ((curr: Record<string, boolean>) => Record<string, boolean>)) => void;
}

export const UsageFilterMenu: FunctionComponent<UsageFilterMenuProps> = ({
  isOpen,
  onClose,
  stats,
  enabledSeries,
  setEnabledSeries,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;

    const ctx = gsap.matchMedia();
    ctx.add("(prefers-reduced-motion: no-preference)", () => {
      if (isOpen) {
        gsap.fromTo(
          menuRef.current,
          { opacity: 0, scale: 0.95, y: -10 },
          { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'power2.out' }
        );
      } else {
        gsap.to(menuRef.current, {
          opacity: 0,
          scale: 0.95,
          y: -10,
          duration: 0.2,
          ease: 'power2.in',
        });
      }
    });

    ctx.add("(prefers-reduced-motion: reduce)", () => {
      if (isOpen) {
        gsap.set(menuRef.current, { opacity: 1, scale: 1, y: 0 });
      } else {
        gsap.set(menuRef.current, { opacity: 0, scale: 0.95, y: -10 });
      }
    });

    if (isOpen) {
      // Focus the close button when opened for keyboard support
      closeButtonRef.current?.focus();
    }

    return () => ctx.revert();
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
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 dark:text-white">
              Graph Filters
            </span>
            {activeSeriesCount > 0 && (
              <button
                type="button"
                onClick={() => setEnabledSeries({})}
                className="text-xs text-slate-400 transition-colors hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 rounded"
              >
                Reset filters
              </button>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stats && (
          <div className={styles.section}>
            <label className={styles.label}>Metric Series</label>
            <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-2">
              {(() => {
                const groups = stats.chartSeries.reduce((acc, s) => {
                  (acc[s.grouping] ??= []).push(s);
                  return acc;
                }, {} as Record<string, typeof stats.chartSeries>);
                const displayOrder = ['core', 'purposes', 'providers', 'git'];
                const orderedGroups = [
                  ...displayOrder.filter((groupKey) => groups[groupKey]?.length),
                  ...Object.keys(groups).filter((groupKey) => !displayOrder.includes(groupKey) && groups[groupKey]?.length),
                ];

                return orderedGroups.map((groupKey) => {
                  const groupLabel = (
                    groupKey === 'core'
                      ? 'Core'
                      : groupKey === 'purposes'
                        ? 'Purposes'
                        : groupKey === 'providers'
                          ? 'Providers'
                          : groupKey === 'git'
                            ? 'Git'
                            : groupKey.charAt(0).toUpperCase() + groupKey.slice(1)
                  );

                  return (
                    <div key={groupKey} className="flex flex-col">
                      <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mt-3 mb-1 px-1">
                        {groupLabel}
                      </div>
                      <div className="flex flex-col gap-2">
                        {groups[groupKey].map((s) => {
                          const active = enabledSeries[s.id] || false;
                          const disabled = activeSeriesCount === 1 && active;
                          const groupActiveCount = groups[groupKey].filter((item) => enabledSeries[item.id]).length;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (activeSeriesCount === 1 && enabledSeries[s.id]) return;
                                setEnabledSeries((curr) => ({ ...curr, [s.id]: !curr[s.id] }));
                              }}
                              disabled={disabled}
                              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 ${
                                active
                                  ? 'border-amber-500/28 bg-amber-500/12 text-amber-700 dark:text-amber-300'
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
                                <div className="flex items-center gap-1.5">
                                  {groupActiveCount > 1 && (
                                    <div className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold text-amber-700 dark:bg-amber-500/30 dark:text-amber-200">
                                      +{groupActiveCount - 1}
                                    </div>
                                  )}
                                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
