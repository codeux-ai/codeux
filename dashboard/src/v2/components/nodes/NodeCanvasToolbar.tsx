import type { FunctionComponent } from "preact";
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-preact";
import { IconButton } from "../IconButton.js";
import { useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodeCanvasToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitView: () => void;
}

export const NodeCanvasToolbar: FunctionComponent<NodeCanvasToolbarProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitView,
}) => {
  const { t } = useNodesI18n();
  return <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-[0.85rem] border border-black/[0.08] bg-white/88 p-1 shadow-[0_12px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/[0.10] dark:bg-void-900/82">
    <IconButton title={t("zoomOut")} aria-label={t("zoomOutCanvas")} className="h-9 w-9 rounded-[0.65rem]" onClick={onZoomOut}>
      <ZoomOut className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <IconButton title={t("zoomIn")} aria-label={t("zoomInCanvas")} className="h-9 w-9 rounded-[0.65rem]" onClick={onZoomIn}>
      <ZoomIn className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <span className="min-w-[3.25rem] px-2 text-center text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300" aria-label={t("zoomPercent", { percent: Math.round(zoom * 100) })}>
      {Math.round(zoom * 100)}%
    </span>
    <IconButton title={t("resetView")} aria-label={t("resetCanvasView")} className="h-9 w-9 rounded-[0.65rem]" onClick={onResetView}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <IconButton title={t("fitView")} aria-label={t("fitCanvasView")} className="h-9 w-9 rounded-[0.65rem]" onClick={onFitView}>
      <Maximize2 className="h-4 w-4" aria-hidden="true" />
    </IconButton>
  </div>;
};
