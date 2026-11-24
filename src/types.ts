export type ItemKey = string | number;

export type ScrollAlign = 'start' | 'center' | 'end' | 'auto';

export type ScrollBehaviorMode = 'auto' | 'smooth' | 'instant';

export type ScrollDirection = 'forward' | 'backward' | 'idle';

export interface ScrollToIndexOptions {
  align?: ScrollAlign;
  behavior?: ScrollBehaviorMode;
  offset?: number;
}

export interface ResizeObserverSizeLike {
  readonly blockSize: number;
  readonly inlineSize: number;
}

export interface ResizeObserverEntryLike {
  readonly target: ElementLike;
  readonly contentRect: {
    readonly width: number;
    readonly height: number;
  };
  readonly borderBoxSize?: readonly ResizeObserverSizeLike[];
}

export interface ResizeObserverLike {
  observe(target: ElementLike, options?: { box?: string }): void;
  unobserve(target: ElementLike): void;
  disconnect(): void;
}

export type ResizeObserverConstructorLike = new (
  callback: (entries: readonly ResizeObserverEntryLike[]) => void
) => ResizeObserverLike;

export interface ElementLike {
  readonly clientWidth?: number;
  readonly clientHeight?: number;
  readonly offsetHeight?: number;
  getBoundingClientRect?: () => { width: number; height: number; top: number; left: number };
}

export interface ScrollTargetLike {
  scrollTop?: number;
  scrollY?: number;
  clientHeight?: number;
  innerHeight?: number;
  addEventListener(
    type: string,
    listener: (...args: unknown[]) => void,
    options?: boolean | { passive?: boolean }
  ): void;
  removeEventListener(
    type: string,
    listener: (...args: unknown[]) => void,
    options?: boolean | { passive?: boolean }
  ): void;
  scrollTo?: (options: { top: number; behavior?: ScrollBehaviorMode }) => void;
  scrollBy?: (options: { top: number; behavior?: ScrollBehaviorMode }) => void;
}

export interface GridOptions<T = unknown> {
  count?: number;
  items?: readonly T[];
  getItemKey?: (index: number, item: T | undefined) => ItemKey;
  estimateHeight?: number | ((index: number, columnWidth: number, item: T | undefined) => number);
  adaptiveEstimation?: boolean;
  columns?: number;
  minColumnWidth?: number;
  maxColumns?: number;
  gap?: number;
  columnGap?: number;
  rowGap?: number;
  paddingStart?: number;
  paddingEnd?: number;
  overscan?: number;
  maxVelocityOverscan?: number;
  heightEpsilon?: number;
  checkpointInterval?: number;
  scrollAnchor?: boolean;
  scrollingResetDelay?: number;
  initialContainerWidth?: number;
  initialViewportHeight?: number;
  initialScrollTop?: number;
  resizeObserverConstructor?: ResizeObserverConstructorLike;
  onScrollCorrection?: (deltaY: number) => void;
  onRangeChange?: (snapshot: VirtualGridSnapshot<T>) => void;
}

export interface ItemPlacement {
  readonly index: number;
  readonly key: ItemKey;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bottom: number;
  readonly measured: boolean;
}

export interface VirtualItemStyle {
  readonly position: 'absolute';
  readonly top: 0;
  readonly left: 0;
  readonly width: string;
  readonly transform: string;
  readonly willChange: 'transform';
}

export interface VirtualItem<T = unknown> extends ItemPlacement {
  readonly data: T | undefined;
  readonly style: VirtualItemStyle;
}

export interface VisibleRange {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly overscanTop: number;
  readonly overscanBottom: number;
}

export interface VirtualGridSnapshot<T = unknown> {
  readonly items: readonly VirtualItem<T>[];
  readonly totalHeight: number;
  readonly totalCount: number;
  readonly columnCount: number;
  readonly columnWidth: number;
  readonly containerWidth: number;
  readonly viewportHeight: number;
  readonly scrollTop: number;
  readonly scrollDirection: ScrollDirection;
  readonly isScrolling: boolean;
  readonly visibleRange: VisibleRange;
}

export type GridListener<T = unknown> = (snapshot: VirtualGridSnapshot<T>) => void;

export interface AnchorState {
  readonly index: number;
  readonly key: ItemKey;
  readonly offset: number;
}

export interface LayoutCheckpoint {
  readonly itemIndex: number;
  readonly columnHeights: Float64Array;
  readonly columnCounts: Uint32Array;
}

export interface ColumnMetrics {
  readonly columnCount: number;
  readonly columnWidth: number;
}

export interface OverscanBounds {
  readonly minY: number;
  readonly maxY: number;
}
