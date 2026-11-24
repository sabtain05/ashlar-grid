import { MasonryLayoutEngine } from './layout-engine.js';
import { computeOverscanBounds, resolveColumnMetrics } from './math.js';
import { ResizeTracker } from './resize-tracker.js';
import { ScrollTracker, type ScrollState } from './scroll-tracker.js';
import type {
  ElementLike,
  GridListener,
  GridOptions,
  ItemKey,
  ItemPlacement,
  ScrollTargetLike,
  ScrollToIndexOptions,
  VirtualGridSnapshot,
  VirtualItem
} from './types.js';

const DEFAULT_MIN_COLUMN_WIDTH = 240;
const DEFAULT_MAX_COLUMNS = 24;
const DEFAULT_GAP = 16;
const DEFAULT_OVERSCAN = 320;
const DEFAULT_MAX_VELOCITY_OVERSCAN = 640;
const DEFAULT_ESTIMATE_HEIGHT = 240;
const DEFAULT_HEIGHT_EPSILON = 0.5;
const DEFAULT_CHECKPOINT_INTERVAL = 64;
const DEFAULT_SCROLLING_RESET_DELAY = 150;
const DEFAULT_CONTAINER_WIDTH = 1024;
const DEFAULT_VIEWPORT_HEIGHT = 768;

function defaultGetItemKey(index: number): ItemKey {
  return index;
}

export class AshlarGrid<T = unknown> {
  private options: GridOptions<T>;
  private layout: MasonryLayoutEngine<T>;
  private resizeTracker: ResizeTracker;
  private scrollTracker: ScrollTracker;
  private listeners = new Set<GridListener<T>>();
  private refCallbacks = new Map<ItemKey, (element: ElementLike | null) => void>();

  private containerWidth: number;
  private snapshot: VirtualGridSnapshot<T>;
  private destroyed = false;

  constructor(options: GridOptions<T> = {}) {
    this.options = { ...options };
    this.containerWidth = Math.max(0, options.initialContainerWidth ?? DEFAULT_CONTAINER_WIDTH);

    const estimateFn = this.resolveEstimateFunction(options.estimateHeight);

    this.layout = new MasonryLayoutEngine<T>({
      getItemKey: options.getItemKey ?? defaultGetItemKey,
      estimateHeight: estimateFn,
      adaptiveEstimation: options.adaptiveEstimation ?? true,
      checkpointInterval: options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL
    });

    this.applyGeometry();

    const initialCount = options.items ? options.items.length : (options.count ?? 0);
    this.layout.setItems(initialCount, options.items);

    this.scrollTracker = new ScrollTracker(
      {
        onScrollFrame: (state) => {
          this.handleScrollUpdate(state);
        }
      },
      {
        scrollTop: options.initialScrollTop ?? 0,
        viewportHeight: options.initialViewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
        scrollingResetDelay: options.scrollingResetDelay ?? DEFAULT_SCROLLING_RESET_DELAY
      }
    );

    this.resizeTracker = new ResizeTracker(
      {
        onItemHeightsBatch: (heights) => {
          this.handleMeasuredHeightsBatch(heights);
        },
        onContainerWidth: (width) => {
          this.reportContainerWidth(width);
        }
      },
      options.resizeObserverConstructor
    );

    this.snapshot = this.buildSnapshot(this.scrollTracker.getState());
  }

  subscribe(listener: GridListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): VirtualGridSnapshot<T> {
    return this.snapshot;
  }

  attachScrollContainer(target: ScrollTargetLike | null): () => void {
    if (this.destroyed) return () => {};
    return this.scrollTracker.attach(target);
  }

  attachGridContainer(element: ElementLike | null): () => void {
    if (this.destroyed) return () => {};
    this.resizeTracker.observeContainer(element);
    return () => {
      this.resizeTracker.observeContainer(null);
    };
  }

  measureElement(key: ItemKey, element: ElementLike | null): void {
    if (this.destroyed) return;
    this.resizeTracker.observeItem(key, element);
  }

  createItemRef(key: ItemKey): (element: ElementLike | null) => void {
    let cb = this.refCallbacks.get(key);
    if (!cb) {
      cb = (element: ElementLike | null) => {
        if (!element) {
          this.refCallbacks.delete(key);
        }
        this.measureElement(key, element);
      };
      this.refCallbacks.set(key, cb);
    }
    return cb;
  }

  reportItemHeight(key: ItemKey, height: number): void {
    if (this.destroyed) return;
    const batch = new Map<ItemKey, number>([[key, height]]);
    this.handleMeasuredHeightsBatch(batch);
  }

  reportContainerWidth(width: number): void {
    if (this.destroyed || !Number.isFinite(width) || width < 0) return;
    if (Math.abs(this.containerWidth - width) <= 0.5) return;

    const scrollState = this.scrollTracker.getState();
    const anchor =
      this.options.scrollAnchor !== false ? this.layout.getAnchor(scrollState.scrollTop) : null;

    this.containerWidth = width;
    const changed = this.applyGeometry();
    if (!changed) return;

    if (anchor) {
      const deltaY = this.layout.computeAnchorDelta(anchor, scrollState.scrollTop);
      this.applyAnchorCorrection(deltaY);
    }

    this.recomputeAndEmit();
  }

  reportScroll(scrollTop: number, viewportHeight?: number): void {
    if (this.destroyed) return;
    this.scrollTracker.setManualScroll(scrollTop, viewportHeight);
  }

  setItems(itemsOrCount: readonly T[] | number): void {
    if (this.destroyed) return;
    if (typeof itemsOrCount === 'number') {
      this.layout.setItems(itemsOrCount, undefined);
    } else {
      this.layout.setItems(itemsOrCount.length, itemsOrCount);
    }
    this.recomputeAndEmit();
  }

  appendItems(itemsOrCount: readonly T[] | number): void {
    if (this.destroyed) return;
    if (typeof itemsOrCount === 'number') {
      this.layout.appendItems(itemsOrCount, undefined);
    } else {
      this.layout.appendItems(itemsOrCount.length, itemsOrCount);
    }
    this.recomputeAndEmit();
  }

  updateOptions(partial: Partial<GridOptions<T>>): void {
    if (this.destroyed) return;
    this.options = { ...this.options, ...partial };

    if (partial.scrollingResetDelay !== undefined) {
      this.scrollTracker.setScrollingResetDelay(partial.scrollingResetDelay);
    }

    const configChanged =
      partial.getItemKey !== undefined ||
      partial.estimateHeight !== undefined ||
      partial.adaptiveEstimation !== undefined ||
      partial.checkpointInterval !== undefined;

    if (configChanged) {
      this.layout.updateConfig({
        getItemKey: this.options.getItemKey ?? defaultGetItemKey,
        estimateHeight: this.resolveEstimateFunction(this.options.estimateHeight),
        adaptiveEstimation: this.options.adaptiveEstimation ?? true,
        checkpointInterval: this.options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL
      });
    }

    if (partial.items !== undefined) {
      this.layout.setItems(partial.items.length, partial.items);
    } else if (partial.count !== undefined) {
      this.layout.setItems(partial.count, undefined);
    }

    this.applyGeometry();
    this.recomputeAndEmit();
  }

  scrollToIndex(index: number, options: ScrollToIndexOptions = {}): number | null {
    if (this.destroyed) return null;
    const placement = this.layout.getPlacement(index);
    if (!placement) return null;

    const scrollState = this.scrollTracker.getState();
    const align = options.align ?? 'auto';
    const offset = options.offset ?? 0;
    const viewportHeight = scrollState.viewportHeight;
    const currentTop = scrollState.scrollTop;
    const currentBottom = currentTop + viewportHeight;

    let targetTop = currentTop;

    if (align === 'start') {
      targetTop = placement.y + offset;
    } else if (align === 'center') {
      targetTop = placement.y - (viewportHeight - placement.height) / 2 + offset;
    } else if (align === 'end') {
      targetTop = placement.bottom - viewportHeight + offset;
    } else {
      if (placement.y < currentTop) {
        targetTop = placement.y + offset;
      } else if (placement.bottom > currentBottom) {
        targetTop = placement.bottom - viewportHeight + offset;
      } else {
        return currentTop;
      }
    }

    const maxScroll = Math.max(0, this.layout.getTotalHeight() - viewportHeight);
    const clampedTop = Math.max(0, Math.min(targetTop, maxScroll));
    this.scrollTracker.scrollTo(clampedTop, options.behavior ?? 'auto');
    return clampedTop;
  }

  invalidateMeasurement(key?: ItemKey): void {
    if (this.destroyed) return;
    if (this.layout.invalidateMeasurement(key)) {
      this.recomputeAndEmit();
    }
  }

  getItemPlacement(index: number): ItemPlacement | undefined {
    return this.layout.getPlacement(index);
  }

  flush(): void {
    if (this.destroyed) return;
    this.resizeTracker.flush();
    this.scrollTracker.flush();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeTracker.destroy();
    this.scrollTracker.destroy();
    this.listeners.clear();
    this.refCallbacks.clear();
  }

  private resolveEstimateFunction(
    estimate?: GridOptions<T>['estimateHeight']
  ): (index: number, columnWidth: number, item: T | undefined) => number {
    if (typeof estimate === 'function') {
      return estimate;
    }
    const fixed =
      typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0
        ? estimate
        : DEFAULT_ESTIMATE_HEIGHT;
    return () => fixed;
  }

  private applyGeometry(): boolean {
    const columnGap = this.options.columnGap ?? this.options.gap ?? DEFAULT_GAP;
    const rowGap = this.options.rowGap ?? this.options.gap ?? DEFAULT_GAP;
    const paddingStart = this.options.paddingStart ?? 0;
    const paddingEnd = this.options.paddingEnd ?? 0;

    const metrics = resolveColumnMetrics(this.containerWidth, {
      columns: this.options.columns,
      minColumnWidth: this.options.minColumnWidth ?? DEFAULT_MIN_COLUMN_WIDTH,
      maxColumns: this.options.maxColumns ?? DEFAULT_MAX_COLUMNS,
      columnGap
    });

    return this.layout.setGeometry(
      metrics.columnCount,
      metrics.columnWidth,
      columnGap,
      rowGap,
      paddingStart,
      paddingEnd
    );
  }

  private handleMeasuredHeightsBatch(heights: ReadonlyMap<ItemKey, number>): void {
    if (this.destroyed || heights.size === 0) return;

    const epsilon = this.options.heightEpsilon ?? DEFAULT_HEIGHT_EPSILON;
    const scrollState = this.scrollTracker.getState();
    const shouldAnchor = this.options.scrollAnchor !== false && scrollState.scrollTop > 0;
    const anchor = shouldAnchor ? this.layout.getAnchor(scrollState.scrollTop) : null;

    let anyChanged = false;
    let changedAboveAnchor = false;

    for (const [key, height] of heights) {
      const result = this.layout.setMeasuredHeight(key, height, epsilon);
      if (result.changed) {
        anyChanged = true;
        if (anchor && result.index < anchor.index) {
          changedAboveAnchor = true;
        }
      }
    }

    if (!anyChanged) return;

    if (anchor && changedAboveAnchor) {
      const deltaY = this.layout.computeAnchorDelta(anchor, scrollState.scrollTop);
      this.applyAnchorCorrection(deltaY);
    }

    this.recomputeAndEmit();
  }

  private applyAnchorCorrection(deltaY: number): void {
    if (Math.abs(deltaY) < 0.5) return;
    if (typeof this.options.onScrollCorrection === 'function') {
      this.options.onScrollCorrection(deltaY);
    }
    this.scrollTracker.applyScrollCorrection(deltaY);
  }

  private handleScrollUpdate(state: ScrollState): void {
    if (this.destroyed) return;
    const nextSnapshot = this.buildSnapshot(state);
    if (this.snapshotsEqual(this.snapshot, nextSnapshot)) {
      return;
    }
    this.snapshot = nextSnapshot;
    this.emitSnapshot(nextSnapshot);
  }

  private recomputeAndEmit(): void {
    const nextSnapshot = this.buildSnapshot(this.scrollTracker.getState());
    this.snapshot = nextSnapshot;
    this.emitSnapshot(nextSnapshot);
  }

  private buildSnapshot(scrollState: ScrollState): VirtualGridSnapshot<T> {
    const bounds = computeOverscanBounds(
      scrollState.scrollTop,
      scrollState.viewportHeight,
      this.options.overscan ?? DEFAULT_OVERSCAN,
      scrollState.velocity,
      this.options.maxVelocityOverscan ?? DEFAULT_MAX_VELOCITY_OVERSCAN
    );

    const placements = this.layout.queryVisible(bounds.minY, bounds.maxY);
    const virtualItems = new Array<VirtualItem<T>>(placements.length);

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      virtualItems[i] = {
        index: p.index,
        key: p.key,
        column: p.column,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        bottom: p.bottom,
        measured: p.measured,
        data: this.layout.getItemData(p.index),
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${p.width}px`,
          transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
          willChange: 'transform'
        }
      };
    }

    const startIndex = virtualItems.length > 0 ? virtualItems[0].index : -1;
    const endIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

    return {
      items: virtualItems,
      totalHeight: this.layout.getTotalHeight(),
      totalCount: this.layout.getCount(),
      columnCount: this.layout.getColumnCount(),
      columnWidth: this.layout.getColumnWidth(),
      containerWidth: this.containerWidth,
      viewportHeight: scrollState.viewportHeight,
      scrollTop: scrollState.scrollTop,
      scrollDirection: scrollState.direction,
      isScrolling: scrollState.isScrolling,
      visibleRange: {
        startIndex,
        endIndex,
        overscanTop: bounds.minY,
        overscanBottom: bounds.maxY
      }
    };
  }

  private snapshotsEqual(
    prev: VirtualGridSnapshot<T>,
    next: VirtualGridSnapshot<T>
  ): boolean {
    if (
      prev.totalHeight !== next.totalHeight ||
      prev.totalCount !== next.totalCount ||
      prev.columnCount !== next.columnCount ||
      prev.columnWidth !== next.columnWidth ||
      prev.containerWidth !== next.containerWidth ||
      prev.viewportHeight !== next.viewportHeight ||
      prev.isScrolling !== next.isScrolling ||
      prev.scrollDirection !== next.scrollDirection ||
      prev.items.length !== next.items.length
    ) {
      return false;
    }

    for (let i = 0; i < prev.items.length; i++) {
      const a = prev.items[i];
      const b = next.items[i];
      if (
        a.key !== b.key ||
        a.index !== b.index ||
        a.x !== b.x ||
        a.y !== b.y ||
        a.width !== b.width ||
        a.height !== b.height
      ) {
        return false;
      }
    }

    return true;
  }

  private emitSnapshot(snapshot: VirtualGridSnapshot<T>): void {
    this.options.onRangeChange?.(snapshot);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createAshlarGrid<T = unknown>(
  options?: GridOptions<T>
): AshlarGrid<T> {
  return new AshlarGrid<T>(options);
}
