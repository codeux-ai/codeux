import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import gsap from 'gsap';
import { X } from 'lucide-preact';
import { MODAL_MOTION } from '../../../lib/motion/modal-motion.js';
import type {
  ProjectExecutionStatsChartSeries,
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import styles from './UsageFilterMenu.module.css';
import { UsageGraphLegend } from './UsageGraphLegend.js';

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
          { opacity: MODAL_MOTION.dropdown.opacityStart, scale: MODAL_MOTION.dropdown.scaleStart, y: MODAL_MOTION.dropdown.yStart },
          { opacity: MODAL_MOTION.dropdown.opacityEnd, scale: MODAL_MOTION.dropdown.scaleEnd, y: MODAL_MOTION.dropdown.yEnd, duration: MODAL_MOTION.dropdown.duration, ease: MODAL_MOTION.dropdown.ease }
        );
      } else {
        gsap.to(menuRef.current, {
          opacity: MODAL_MOTION.dropdown.opacityStart,
          scale: MODAL_MOTION.dropdown.scaleStart,
          y: MODAL_MOTION.dropdown.yStart,
          duration: MODAL_MOTION.dropdown.duration * 0.8,
          ease: 'power2.in',
        });
      }
    });

    ctx.add("(prefers-reduced-motion: reduce)", () => {
      if (isOpen) {
        gsap.set(menuRef.current, { opacity: MODAL_MOTION.dropdown.opacityEnd, scale: MODAL_MOTION.dropdown.scaleEnd, y: MODAL_MOTION.dropdown.yEnd });
      } else {
        gsap.set(menuRef.current, { opacity: MODAL_MOTION.dropdown.opacityStart, scale: MODAL_MOTION.dropdown.scaleStart, y: MODAL_MOTION.dropdown.yStart });
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
  const handleResetFilters = () => {
    const chartSeries = stats?.chartSeries ?? [];
    const resetSeries = chartSeries.reduce((acc, series) => {
      acc[series.id] = series.defaultEnabled;
      return acc;
    }, {} as Record<string, boolean>);

    if (chartSeries.length > 0 && Object.values(resetSeries).every((enabled) => !enabled)) {
      resetSeries[chartSeries[0]!.id] = true;
    }

    setEnabledSeries(resetSeries);
  };

  const groupedSeries: Record<string, ProjectExecutionStatsChartSeries[]> = stats?.chartSeries?.reduce((acc, series) => {
    (acc[series.grouping] ??= []).push(series);
    return acc;
  }, {} as Record<string, ProjectExecutionStatsChartSeries[]>) ?? {};

  const displayOrder = ['core', 'purposes', 'providers', 'git'];
  const orderedGroups = displayOrder.filter((groupKey) => groupedSeries[groupKey]?.length)
    .concat(Object.keys(groupedSeries).filter((groupKey) => !displayOrder.includes(groupKey) && groupedSeries[groupKey]?.length));
  const orderedSeriesGroups = orderedGroups.reduce((acc, groupKey) => {
    acc[groupKey] = groupedSeries[groupKey]!;
    return acc;
  }, {} as Record<string, ProjectExecutionStatsChartSeries[]>);

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ display: isOpen || (menuRef.current && gsap.getProperty(menuRef.current, 'opacity') as number > 0) ? 'block' : 'none' }}
    >
      <div className={styles.content}>
        <div className={`${styles.header} flex items-center justify-between`}>
          <div aria-live="polite" className="sr-only">Showing {activeSeriesCount} filter{activeSeriesCount !== 1 ? 's' : ''}</div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 dark:text-white">
              Graph Filters
            </span>
            {activeSeriesCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
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
            aria-label="Close graph filters"
            className="rounded-full p-1 text-slate-400 hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stats && (
          <div className={styles.section}>
            <label className={styles.label}>Metric Series</label>
            <div className="flex max-h-[320px] flex-col gap-4 overflow-y-auto pr-1">
              <UsageGraphLegend
                seriesGroups={orderedSeriesGroups}
                enabledSeries={enabledSeries}
                activeSeriesCount={activeSeriesCount}
                onToggleSeries={(id) => {
                  if (activeSeriesCount === 1 && enabledSeries[id]) {
                    return;
                  }
                  setEnabledSeries((curr) => ({ ...curr, [id]: !curr[id] }));
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
