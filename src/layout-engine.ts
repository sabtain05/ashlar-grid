import {
  findShortestColumn,
  findTallestHeight,
  lowerBoundByBottom,
  upperBoundByTop
} from './math.js';
import type {
  AnchorState,
  ItemKey,
  ItemPlacement,
  LayoutCheckpoint
} from './types.js';

export interface LayoutEngineConfig<T> {
  getItemKey: (index: number, item: T | undefined) => ItemKey;
  estimateHeight: (index: number, columnWidth: number, item: T | undefined) => number;
  adaptiveEstimation: boolean;
  checkpointInterval: number;
}

export interface HeightUpdateResult {
  readonly changed: boolean;
  readonly index: number;
  readonly delta: number;
}

export class MasonryLayoutEngine<T = unknown> {
  private count = 0;
  private itemsData: readonly T[] | undefined = undefined;
  private columnCount = 1;
  private columnWidth = 300;
  private columnGap = 16;
  private rowGap = 16;
  private paddingStart = 0;
  private paddingEnd = 0;
  private config: LayoutEngineConfig<T>;

  private placements: ItemPlacement[] = [];
  private columns: ItemPlacement[][] = [[]];
  private columnHeights = new Float64Array(1);
  private checkpoints: LayoutCheckpoint[] = [];
  private measuredHeights = new Map<ItemKey, number>();
  private keyToIndex = new Map<ItemKey, number>();
  private indexToKey: ItemKey[] = [];

  private measuredSum = 0;
  private measuredCount = 0;
  private dirtyFromIndex = 0;
  private totalHeight = 0;

  constructor(config: LayoutEngineConfig<T>) {
    this.config = config;
  }

  updateConfig(config: Partial<LayoutEngineConfig<T>>): void {
    this.config = { ...this.config, ...config };
    this.markDirtyFrom(0);
  }

  setGeometry(
    columnCount: number,
    columnWidth: number,
    columnGap: number,
    rowGap: number,
    paddingStart: number,
    paddingEnd: number
  ): boolean {
    const safeCols = Math.max(1, Math.floor(columnCount));
    const safeWidth = Math.max(0, columnWidth);
    const safeColGap = Math.max(0, columnGap);
    const safeRowGap = Math.max(0, rowGap);
    const safePadStart = Math.max(0, paddingStart);
    const safePadEnd = Math.max(0, paddingEnd);

    const widthChanged = Math.abs(this.columnWidth - safeWidth) > 0.01;
    const geometryChanged =
      this.columnCount !== safeCols ||
      widthChanged ||
      this.columnGap !== safeColGap ||
      this.rowGap !== safeRowGap ||
      this.paddingStart !== safePadStart ||
      this.paddingEnd !== safePadEnd;

    if (!geometryChanged) {
      return false;
    }

    this.columnCount = safeCols;
    this.columnWidth = safeWidth;
    this.columnGap = safeColGap;
    this.rowGap = safeRowGap;
    this.paddingStart = safePadStart;
    this.paddingEnd = safePadEnd;
    this.markDirtyFrom(0);
    return true;
  }

  setItems(count: number, items?: readonly T[]): void {
    const nextCount = Math.max(0, Math.floor(count));
    this.count = nextCount;
    this.itemsData = items;
    this.rebuildKeyIndex(0);
    this.markDirtyFrom(0);
  }

  appendItems(addedCount: number, addedItems?: readonly T[]): void {
    const delta = Math.max(0, Math.floor(addedCount));
    if (delta === 0) return;

    const prevCount = this.count;
    this.count = prevCount + delta;

    if (addedItems) {
      if (this.itemsData) {
        const merged = new Array<T>(this.count);
        for (let i = 0; i < prevCount; i++) {
          merged[i] = this.itemsData[i];
        }
        for (let i = 0; i < delta; i++) {
          merged[prevCount + i] = addedItems[i];
        }
        this.itemsData = merged;
      } else {
        this.itemsData = addedItems;
      }
    }

    this.rebuildKeyIndex(prevCount);
    this.markDirtyFrom(prevCount);
  }

  setMeasuredHeight(key: ItemKey, height: number, epsilon: number): HeightUpdateResult {
    if (!Number.isFinite(height) || height < 0) {
      return { changed: false, index: -1, delta: 0 };
    }

    const index = this.keyToIndex.get(key);
    const prevMeasured = this.measuredHeights.get(key);

    if (prevMeasured !== undefined && Math.abs(prevMeasured - height) <= epsilon) {
      return { changed: false, index: index ?? -1, delta: 0 };
    }

    if (prevMeasured !== undefined) {
      this.measuredSum += height - prevMeasured;
    } else {
      this.measuredSum += height;
      this.measuredCount += 1;
    }

    this.measuredHeights.set(key, height);

    if (index === undefined) {
      return { changed: false, index: -1, delta: 0 };
    }

    const existing = this.placements[index];
    const previousHeight = existing ? existing.height : (prevMeasured ?? 0);
    const delta = height - previousHeight;

    if (existing && Math.abs(delta) <= epsilon && existing.measured) {
      return { changed: false, index, delta: 0 };
    }

    this.markDirtyFrom(index);
    return { changed: true, index, delta };
  }

  invalidateMeasurement(key?: ItemKey): boolean {
    if (key === undefined) {
      if (this.measuredHeights.size === 0) return false;
      this.measuredHeights.clear();
      this.measuredSum = 0;
      this.measuredCount = 0;
      this.markDirtyFrom(0);
      return true;
    }

    const prev = this.measuredHeights.get(key);
    if (prev === undefined) return false;

    this.measuredHeights.delete(key);
    this.measuredSum -= prev;
    this.measuredCount = Math.max(0, this.measuredCount - 1);

    const index = this.keyToIndex.get(key);
    if (index !== undefined) {
      this.markDirtyFrom(index);
    }
    return true;
  }

  recomputeIfDirty(): boolean {
    if (this.dirtyFromIndex >= this.count && this.placements.length === this.count) {
      if (this.count === 0) {
        this.totalHeight = this.paddingStart + this.paddingEnd;
      }
      return false;
    }

    const startFrom = Math.min(this.dirtyFromIndex, this.placements.length, this.count);
    const colCount = this.columnCount;
    const interval = Math.max(1, this.config.checkpointInterval);

    let startIndex = 0;
    const heights = new Float64Array(colCount);

    if (startFrom === 0 || this.columns.length !== colCount) {
      this.columns = Array.from({ length: colCount }, () => []);
      this.placements = new Array<ItemPlacement>(this.count);
      this.checkpoints = [];
      heights.fill(this.paddingStart);
    } else {
      const checkpoint = this.findCheckpoint(startFrom);
      if (checkpoint && checkpoint.columnHeights.length === colCount) {
        startIndex = checkpoint.itemIndex;
        heights.set(checkpoint.columnHeights);
        for (let c = 0; c < colCount; c++) {
          this.columns[c].length = checkpoint.columnCounts[c];
        }
        const keepCheckpoints = Math.max(0, Math.floor(startIndex / interval) - 1);
        this.checkpoints.length = Math.min(this.checkpoints.length, keepCheckpoints);
      } else {
        this.columns = Array.from({ length: colCount }, () => []);
        this.checkpoints = [];
        heights.fill(this.paddingStart);
      }
      this.placements.length = this.count;
    }

    const colStep = this.columnWidth + this.columnGap;
    const adaptiveAverage =
      this.config.adaptiveEstimation && this.measuredCount > 0
        ? this.measuredSum / this.measuredCount
        : null;

    for (let i = startIndex; i < this.count; i++) {
      if (i > 0 && i % interval === 0) {
        const snapshotCounts = new Uint32Array(colCount);
        for (let c = 0; c < colCount; c++) {
          snapshotCounts[c] = this.columns[c].length;
        }
        this.checkpoints.push({
          itemIndex: i,
          columnHeights: new Float64Array(heights),
          columnCounts: snapshotCounts
        });
      }

      const key = this.indexToKey[i];
      const measuredHeight = this.measuredHeights.get(key);
      const measured = measuredHeight !== undefined;

      let itemHeight: number;
      if (measured) {
        itemHeight = measuredHeight;
      } else if (adaptiveAverage !== null) {
        itemHeight = adaptiveAverage;
      } else {
        itemHeight = Math.max(
          0,
          this.config.estimateHeight(i, this.columnWidth, this.itemsData?.[i])
        );
      }

      const column = findShortestColumn(heights);
      const isColumnEmpty = this.columns[column].length === 0;
      const y = isColumnEmpty ? heights[column] : heights[column] + this.rowGap;
      const bottom = y + itemHeight;
      const x = column * colStep;

      const placement: ItemPlacement = {
        index: i,
        key,
        column,
        x,
        y,
        width: this.columnWidth,
        height: itemHeight,
        bottom,
        measured
      };

      this.placements[i] = placement;
      this.columns[column].push(placement);
      heights[column] = bottom;
    }

    this.columnHeights = heights;
    const maxColumnBottom = this.count > 0 ? findTallestHeight(heights) : this.paddingStart;
    this.totalHeight = maxColumnBottom + this.paddingEnd;
    this.dirtyFromIndex = this.count;
    return true;
  }

  queryVisible(minY: number, maxY: number): ItemPlacement[] {
    this.recomputeIfDirty();

    if (this.count === 0 || maxY < minY) {
      return [];
    }

    const visible: ItemPlacement[] = [];
    for (let c = 0; c < this.columns.length; c++) {
      const colItems = this.columns[c];
      if (colItems.length === 0) continue;

      const start = lowerBoundByBottom(colItems, minY);
      const end = upperBoundByTop(colItems, maxY);

      for (let j = start; j < end; j++) {
        visible.push(colItems[j]);
      }
    }

    visible.sort((a, b) => a.index - b.index);
    return visible;
  }

  getAnchor(scrollTop: number): AnchorState | null {
    this.recomputeIfDirty();
    if (this.count === 0 || scrollTop <= this.paddingStart) {
      return null;
    }

    let best: ItemPlacement | null = null;
    for (let c = 0; c < this.columns.length; c++) {
      const colItems = this.columns[c];
      if (colItems.length === 0) continue;

      const idx = lowerBoundByBottom(colItems, scrollTop);
      if (idx < colItems.length) {
        const candidate = colItems[idx];
        if (!best || candidate.index < best.index) {
          best = candidate;
        }
      }
    }

    if (!best) return null;

    return {
      index: best.index,
      key: best.key,
      offset: scrollTop - best.y
    };
  }

  computeAnchorDelta(anchor: AnchorState, currentScrollTop: number): number {
    this.recomputeIfDirty();
    const index = this.keyToIndex.get(anchor.key);
    if (index === undefined) return 0;

    const placement = this.placements[index];
    if (!placement) return 0;

    const expectedScrollTop = placement.y + anchor.offset;
    return expectedScrollTop - currentScrollTop;
  }

  getPlacement(index: number): ItemPlacement | undefined {
    this.recomputeIfDirty();
    return this.placements[index];
  }

  getPlacementByKey(key: ItemKey): ItemPlacement | undefined {
    const index = this.keyToIndex.get(key);
    if (index === undefined) return undefined;
    return this.getPlacement(index);
  }

  getIndexByKey(key: ItemKey): number | undefined {
    return this.keyToIndex.get(key);
  }

  getTotalHeight(): number {
    this.recomputeIfDirty();
    return this.totalHeight;
  }

  getCount(): number {
    return this.count;
  }

  getColumnCount(): number {
    return this.columnCount;
  }

  getColumnWidth(): number {
    return this.columnWidth;
  }

  getItemData(index: number): T | undefined {
    return this.itemsData?.[index];
  }

  getItemKey(index: number): ItemKey {
    return this.indexToKey[index];
  }

  isDirty(): boolean {
    return this.dirtyFromIndex < this.count || this.placements.length !== this.count;
  }

  private markDirtyFrom(index: number): void {
    const clamped = Math.max(0, index);
    if (clamped < this.dirtyFromIndex) {
      this.dirtyFromIndex = clamped;
    }
  }

  private rebuildKeyIndex(fromIndex: number): void {
    if (fromIndex === 0) {
      this.keyToIndex.clear();
      this.indexToKey = new Array<ItemKey>(this.count);
    } else {
      this.indexToKey.length = this.count;
    }

    for (let i = fromIndex; i < this.count; i++) {
      const key = this.config.getItemKey(i, this.itemsData?.[i]);
      this.indexToKey[i] = key;
      this.keyToIndex.set(key, i);
    }
  }

  private findCheckpoint(targetIndex: number): LayoutCheckpoint | null {
    if (this.checkpoints.length === 0) return null;

    let low = 0;
    let high = this.checkpoints.length - 1;
    let best: LayoutCheckpoint | null = null;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cp = this.checkpoints[mid];
      if (cp.itemIndex <= targetIndex) {
        best = cp;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }
}
