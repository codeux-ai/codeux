import type { FunctionComponent } from "preact";
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-preact";
import { IconButton } from "../IconButton.js";

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
}) => (
  <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-[0.85rem] border border-black/[0.08] bg-white/88 p-1 shadow-[0_12px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/[0.10] dark:bg-void-900/82">
    <IconButton title="Zoom out" aria-label="Zoom out node canvas" className="h-9 w-9 rounded-[0.65rem]" onClick={onZoomOut}>
      <ZoomOut className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <IconButton title="Zoom in" aria-label="Zoom in node canvas" className="h-9 w-9 rounded-[0.65rem]" onClick={onZoomIn}>
      <ZoomIn className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <span className="min-w-[3.25rem] px-2 text-center text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>
      {Math.round(zoom * 100)}%
    </span>
    <IconButton title="Reset view" aria-label="Reset node canvas view" className="h-9 w-9 rounded-[0.65rem]" onClick={onResetView}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </IconButton>
    <IconButton title="Fit view" aria-label="Fit node canvas view" className="h-9 w-9 rounded-[0.65rem]" onClick={onFitView}>
      <Maximize2 className="h-4 w-4" aria-hidden="true" />
    </IconButton>
  </div>
);
