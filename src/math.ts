import type { ColumnMetrics, ItemPlacement, OverscanBounds } from './types.js';

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function resolveColumnMetrics(
  containerWidth: number,
  options: {
    columns?: number;
    minColumnWidth: number;
    maxColumns: number;
    columnGap: number;
  }
): ColumnMetrics {
  const safeWidth = Math.max(0, containerWidth);
  const safeGap = Math.max(0, options.columnGap);
  const maxCols = Math.max(1, Math.floor(options.maxColumns));

  let columnCount: number;
  if (typeof options.columns === 'number' && options.columns >= 1) {
    columnCount = clamp(Math.floor(options.columns), 1, maxCols);
  } else {
    const safeMinWidth = Math.max(1, options.minColumnWidth);
    const rawCount = Math.floor((safeWidth + safeGap) / (safeMinWidth + safeGap));
    columnCount = clamp(rawCount, 1, maxCols);
  }

  const totalGap = safeGap * (columnCount - 1);
  const availableWidth = Math.max(0, safeWidth - totalGap);
  const columnWidth = columnCount > 0 ? availableWidth / columnCount : 0;

  return { columnCount, columnWidth };
}

export function findShortestColumn(heights: Float64Array): number {
  let shortestIndex = 0;
  let minHeight = heights[0] ?? 0;
  for (let i = 1; i < heights.length; i++) {
    const h = heights[i];
    if (h < minHeight) {
      minHeight = h;
      shortestIndex = i;
    }
  }
  return shortestIndex;
}

export function findTallestHeight(heights: Float64Array): number {
  let maxHeight = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h > maxHeight) {
      maxHeight = h;
    }
  }
  return maxHeight;
}

export function lowerBoundByBottom(
  columnItems: readonly ItemPlacement[],
  targetY: number
): number {
  let low = 0;
  let high = columnItems.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (columnItems[mid].bottom <= targetY) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function upperBoundByTop(
  columnItems: readonly ItemPlacement[],
  targetY: number
): number {
  let low = 0;
  let high = columnItems.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (columnItems[mid].y < targetY) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function computeOverscanBounds(
  scrollTop: number,
  viewportHeight: number,
  baseOverscan: number,
  velocity: number,
  maxVelocityOverscan: number
): OverscanBounds {
  const safeBase = Math.max(0, baseOverscan);
  const safeMaxExtra = Math.max(0, maxVelocityOverscan);
  const speed = Math.abs(velocity);
  const dynamicExtra = Math.min(safeMaxExtra, speed * 260);

  let topOverscan = safeBase;
  let bottomOverscan = safeBase;

  if (velocity > 0.05) {
    bottomOverscan += dynamicExtra;
    topOverscan = Math.max(safeBase * 0.5, safeBase - dynamicExtra * 0.25);
  } else if (velocity < -0.05) {
    topOverscan += dynamicExtra;
    bottomOverscan = Math.max(safeBase * 0.5, safeBase - dynamicExtra * 0.25);
  }

  return {
    minY: Math.max(0, scrollTop - topOverscan),
    maxY: scrollTop + Math.max(0, viewportHeight) + bottomOverscan
  };
}
