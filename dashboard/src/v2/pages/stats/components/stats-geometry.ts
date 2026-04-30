import type { SegmentDefinition } from "../../../types.js";

export interface ChartPoint {
  x: number;
  y: number;
}

export interface DonutSliceGeometry extends SegmentDefinition {
  path: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  share: number;
}

export function buildPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  return points.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
}

export function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const point = points[0]!;
    return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return points.map((point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }
    const previous = points[index - 1]!;
    const dx = point.x - previous.x;
    return `C ${(previous.x + dx * 0.35).toFixed(2)} ${previous.y.toFixed(2)} ${(point.x - dx * 0.35).toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(" ");
}

export function buildAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return `${buildPath(points)} L ${end.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${start.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
}

export function buildSmoothAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return `${buildSmoothPath(points)} L ${end.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${start.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
}

export function buildPoints(values: number[], width: number, height: number, padding: number): ChartPoint[] {
  const safeValues = values.length > 0 ? values : [0];
  const max = Math.max(...safeValues, 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  return safeValues.map((value, index) => {
    const x = safeValues.length === 1
      ? width / 2
      : padding + (index / (safeValues.length - 1)) * innerWidth;
    const y = height - padding - (value / max) * innerHeight;
    return { x, y };
  });
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
