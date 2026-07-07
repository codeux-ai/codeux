import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import gsap from 'gsap';
import { X } from 'lucide-preact';
import { MODAL_MOTION } from '../../../lib/motion/modal-motion.js';
import type {
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import styles from './UsageFilterMenu.module.css';
import { UsageGraphLegend } from './UsageGraphLegend.js';
import type { GroupedChartSeriesSection } from '../chart-view-models.js';

interface UsageFilterMenuProps {
  isOpen: boolean;
  onClose: () => void;
  stats: ProjectExecutionStatsSnapshot | null;
  enabledSeries: Record<string, boolean>;
  setEnabledSeries: (val: Record<string, boolean> | ((curr: Record<string, boolean>) => Record<string, boolean>)) => void;
  resetEnabledSeries: () => void;
  activeSeriesCount: number;
  seriesGroups: GroupedChartSeriesSection[];
  onStatusChange?: (message: string) => void;
}

export const UsageFilterMenu: FunctionComponent<UsageFilterMenuProps> = ({
  isOpen,
  onClose,
  stats,
  enabledSeries,
  setEnabledSeries,
  resetEnabledSeries,
  activeSeriesCount,
  seriesGroups,
  onStatusChange,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const closeAndRestoreFocus = () => {
    onClose();
    restoreFocusRef.current?.focus();
  };

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
          duration: MODAL_MOTION.overlay.exit,
          ease: MODAL_MOTION.overlay.exitEase,
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
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const firstSeriesSwitch = menuRef.current?.querySelector<HTMLButtonElement>('button[role="switch"]:not(:disabled)');
      const resetButton = menuRef.current?.querySelector<HTMLButtonElement>('[data-usage-filter-reset]');
      (firstSeriesSwitch ?? resetButton ?? closeButtonRef.current)?.focus();
    }

    return () => ctx.revert();
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeAndRestoreFocus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen && !menuRef.current) return null;

  const handleResetFilters = () => {
    resetEnabledSeries();
    const defaultEnabledCount = seriesGroups.reduce((count, group) => count + group.defaultEnabledCount, 0);
    const enabledCount = defaultEnabledCount > 0
      ? defaultEnabledCount
      : seriesGroups.some((group) => group.totalCount > 0)
        ? 1
        : 0;
    onStatusChange?.(`Graph filters reset. ${enabledCount} series active.`);
  };

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-labelledby="usage-graph-filter-menu-title"
      aria-describedby="usage-graph-filter-menu-count usage-graph-filter-menu-help"
      className={styles.menu}
      style={{ display: isOpen || (menuRef.current && gsap.getProperty(menuRef.current, 'opacity') as number > 0) ? 'block' : 'none' }}
    >
      <div className={styles.content}>
        <div className={`${styles.header} flex items-center justify-between`}>
          <div id="usage-graph-filter-menu-count" aria-live="polite" className="sr-only">Showing {activeSeriesCount} filter{activeSeriesCount !== 1 ? 's' : ''}</div>
          <div id="usage-graph-filter-menu-help" className="sr-only">At least one chart series must remain enabled.</div>
          <div className="flex items-center gap-3">
            <span id="usage-graph-filter-menu-title" className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-value-color)]">
              Graph Filters
            </span>
            {activeSeriesCount > 0 && (
              <button
                type="button"
                data-usage-filter-reset
                onClick={handleResetFilters}
                className="rounded text-xs text-[var(--stats-detail-color)] transition-colors hover:text-[var(--stats-value-color)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] motion-reduce:transition-none"
              >
                Reset filters
              </button>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="Close graph filters"
            className="rounded-full p-1 text-[var(--stats-detail-color)] transition-colors hover:bg-[color:var(--fill-muted-hover)] hover:text-[var(--stats-value-color)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] motion-reduce:transition-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stats && (
          <div className={styles.section}>
            <div className={styles.label}>Metric Series</div>
            <div className="flex max-h-[320px] flex-col gap-4 overflow-y-auto pr-1">
              <UsageGraphLegend
                seriesGroups={seriesGroups}
                enabledSeries={enabledSeries}
                activeSeriesCount={activeSeriesCount}
                onToggleSeries={(id) => {
                  if (activeSeriesCount === 1 && enabledSeries[id]) {
                    onStatusChange?.("Keep at least one series enabled. The last active series cannot be turned off.");
                    return;
                  }
                  setEnabledSeries((curr) => ({ ...curr, [id]: !curr[id] }));
                  const seriesLabel = stats.chartSeries.find((series) => series.id === id)?.label ?? id;
                  const nextEnabled = !enabledSeries[id];
                  onStatusChange?.(`${seriesLabel} series ${nextEnabled ? "enabled" : "disabled"}. ${activeSeriesCount + (nextEnabled ? 1 : -1)} series active.`);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
