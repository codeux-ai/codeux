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
import { CHIP_CLASS, CONTROL_FOCUS_CLASS } from './stats-ui-primitives.js';
import { useStatsI18n } from '../stats-i18n.js';

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
  const { locale, formatNumber } = useStatsI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const defaultEnabledCount = seriesGroups.reduce((count, group) => count + group.defaultEnabledCount, 0);
  const totalSeriesCount = seriesGroups.reduce((count, group) => count + group.totalCount, 0);
  const resetActiveCount = defaultEnabledCount > 0
    ? defaultEnabledCount
    : totalSeriesCount > 0
      ? 1
      : 0;

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
      const firstSeriesSwitch = menuRef.current?.querySelector<HTMLButtonElement>('button[role="switch"]:not([aria-disabled="true"])')
        ?? menuRef.current?.querySelector<HTMLButtonElement>('button[role="switch"]');
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
    onStatusChange?.(locale === 'de' ? `Diagrammfilter zurückgesetzt. ${formatNumber(resetActiveCount)} Reihen aktiv.` : `Graph filters reset. ${formatNumber(resetActiveCount)} series active.`);
  };

  const handleEnableDefaultSeries = () => {
    setEnabledSeries((curr) => {
      const next = { ...curr };
      let changedCount = 0;
      for (const group of seriesGroups) {
        for (const series of group.series) {
          if (series.defaultEnabled && !next[series.id]) {
            next[series.id] = true;
            changedCount++;
          }
        }
      }
      if (changedCount === 0 && activeSeriesCount === 0 && seriesGroups[0]?.series[0]) {
        next[seriesGroups[0].series[0].id] = true;
        changedCount = 1;
      }
      return next;
    });
    const nextActiveCount = activeSeriesCount + seriesGroups.reduce((count, group) => (
      count + group.series.filter((series) => series.defaultEnabled && !enabledSeries[series.id]).length
    ), 0);
    onStatusChange?.(locale === 'de' ? `Standardreihen aktiviert. ${formatNumber(Math.max(nextActiveCount, resetActiveCount))} Reihen aktiv.` : `Default series enabled. ${formatNumber(Math.max(nextActiveCount, resetActiveCount))} series active.`);
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
        <div className={`${styles.header} flex items-start justify-between gap-3`}>
          <div id="usage-graph-filter-menu-count" aria-live="polite" className="sr-only">{locale === 'de' ? `${formatNumber(activeSeriesCount)} Filter angezeigt` : `Showing ${formatNumber(activeSeriesCount)} filter${activeSeriesCount !== 1 ? 's' : ''}`}</div>
          <div id="usage-graph-filter-menu-help" className="sr-only">{locale === 'de' ? 'Mindestens eine Diagrammreihe muss aktiviert bleiben.' : 'At least one chart series must remain enabled.'}</div>
          <div className="min-w-0">
            <span id="usage-graph-filter-menu-title" className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-value-color)]">
              {locale === 'de' ? 'Diagrammfilter' : 'Graph Filters'}
            </span>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                data-usage-filter-reset
                aria-label={locale === 'de' ? 'Filter zurücksetzen' : 'Reset filters'}
                onClick={handleResetFilters}
                className={`${CHIP_CLASS} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
              >
                {locale === 'de' ? 'Standards zurücksetzen' : 'Reset defaults'}
              </button>
              {defaultEnabledCount > 0 ? (
                <button
                  type="button"
                  onClick={handleEnableDefaultSeries}
                  className={`${CHIP_CLASS} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
                >
                  {locale === 'de' ? 'Standards aktivieren' : 'Enable defaults'}
                </button>
              ) : null}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label={locale === 'de' ? 'Diagrammfilter schließen' : 'Close graph filters'}
            className={`rounded-[var(--stats-control-radius)] p-1 text-[var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[var(--stats-value-color)] motion-reduce:transition-none ${CONTROL_FOCUS_CLASS}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stats && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.label}>{locale === 'de' ? 'Kennzahlreihen' : 'Metric Series'}</div>
                <div className={styles.sectionCopy}>{formatNumber(activeSeriesCount)} {locale === 'de' ? 'von' : 'of'} {formatNumber(totalSeriesCount)} {locale === 'de' ? 'Reihen aktiv' : 'series active'}</div>
              </div>
            </div>
            <div className={styles.scrollArea}>
              <UsageGraphLegend
                seriesGroups={seriesGroups}
                enabledSeries={enabledSeries}
                activeSeriesCount={activeSeriesCount}
                onToggleSeries={(id) => {
                  if (activeSeriesCount === 1 && enabledSeries[id]) {
                    onStatusChange?.(locale === 'de' ? "Mindestens eine Reihe muss aktiviert bleiben. Die letzte aktive Reihe kann nicht deaktiviert werden." : "Keep at least one series enabled. The last active series cannot be turned off.");
                    return;
                  }
                  setEnabledSeries((curr) => ({ ...curr, [id]: !curr[id] }));
                  const seriesLabel = stats.chartSeries.find((series) => series.id === id)?.label ?? id;
                  const nextEnabled = !enabledSeries[id];
                  onStatusChange?.(locale === 'de' ? `${seriesLabel}-Reihe ${nextEnabled ? "aktiviert" : "deaktiviert"}. ${formatNumber(activeSeriesCount + (nextEnabled ? 1 : -1))} Reihen aktiv.` : `${seriesLabel} series ${nextEnabled ? "enabled" : "disabled"}. ${formatNumber(activeSeriesCount + (nextEnabled ? 1 : -1))} series active.`);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
