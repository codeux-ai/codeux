import type {
  ExecutionStatsEntitySummary,
  SegmentDefinition,
} from "../../types.js";
import type {
  ChartSeriesId,
  ChartSeriesDefinition,
  LedgerSortKey,
  DonutSliceGeometry,
  ChartPoint,
} from "./components/StatsShared.js";
import { formatTokens, formatDuration } from "./stats-utils.js";

export const CHART_SERIES: ChartSeriesDefinition[] = [
  {
    id: "tokens",
    label: "Tokens",
    accentHex: "#00E0A0",
    accessor: (bucket) => bucket.usage.totalTokens,
    formatter: formatTokens,
    signalLabel: "Throughput",
  },
  {
    id: "active",
    label: "Active Time",
    accentHex: "#FFB800",
    accessor: (bucket) => bucket.usage.activeTimeMs,
    formatter: formatDuration,
    signalLabel: "Latency",
  },
  {
    id: "invocations",
    label: "Invocations",
    accentHex: "#0EA5E9",
    accessor: (bucket) => bucket.usage.invocationCount,
    formatter: (value) => value.toLocaleString(),
    signalLabel: "Volume",
  },
];

export function getChartSeries(id: ChartSeriesId): ChartSeriesDefinition {
  return CHART_SERIES.find((s) => s.id === id) || CHART_SERIES[0]!;
}

export function toTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getLedgerSortValue(item: ExecutionStatsEntitySummary, key: LedgerSortKey): number | string {
  switch (key) {
    case "tokens":
      return item.usage.totalTokens;
    case "active":
      return item.usage.activeTimeMs;
    case "input":
      return item.usage.inputTokens;
    case "output":
      return item.usage.outputTokens;
    case "name":
      return item.label.toLowerCase();
    case "last":
    default:
      return toTimestamp(item.lastActivityAt);
  }
}

export function sortLedgerItems(items: ExecutionStatsEntitySummary[], sortKey: LedgerSortKey, sortDesc: boolean): ExecutionStatsEntitySummary[] {
  return [...items].sort((a, b) => {
    const valA = getLedgerSortValue(a, sortKey);
    const valB = getLedgerSortValue(b, sortKey);
    if (valA < valB) return sortDesc ? 1 : -1;
    if (valA > valB) return sortDesc ? -1 : 1;
    return 0;
  });
}

export function windowLedgerItems(items: ExecutionStatsEntitySummary[], page: number, pageSize: number): ExecutionStatsEntitySummary[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function polarToCartesian(cx: number, cy: number, radius: number, angle: number): ChartPoint {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function buildDonutArcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function buildDonutSlices(segments: SegmentDefinition[]): DonutSliceGeometry[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) {
    return [];
  }

  const outerRadius = 104;
  const innerRadius = 58;
  const cx = 120;
  const cy = 120;
  let cursor = -90;

  return segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const sweep = (segment.value / total) * 360;
      const startAngle = cursor;
      const endAngle = cursor + sweep;
      cursor = endAngle;
      return {
        ...segment,
        share: (segment.value / total) * 100,
        startAngle,
        endAngle,
        midAngle: startAngle + sweep / 2,
        path: buildDonutArcPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle),
      };
    });
}
