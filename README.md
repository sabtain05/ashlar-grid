# ashlar-grid

Zero-dependency headless dynamic-height masonry virtualization engine powered by batched `ResizeObserver`, checkpointed shortest-column reflow, scroll anchoring, and `O(C * log(N / C))` viewport queries.

## Why ashlar-grid

Rendering hundreds or thousands of variable-height cards, media tiles, or dashboard widgets in a Pinterest-style masonry layout quickly saturates DOM memory and main-thread layout budgets on mobile devices. Fixed-height list virtualizers break when items span fluid multi-column tracks or resize asynchronously after image decoding, font loading, or interactive expansion.

`ashlar-grid` separates masonry geometry and virtualization from your UI framework and styling:

- **Headless and framework-agnostic**: Subscribe with `useSyncExternalStore`, Vue composables, Svelte stores, Solid signals, or plain DOM loops.
- **Batched raw `ResizeObserver`**: Tracks all mounted items through a single shared observer instance, reads `borderBoxSize` without forced synchronous reflows, and flushes updates once per animation frame.
- **Checkpointed incremental reflow**: Stores column-height snapshots at configurable intervals (`checkpointInterval`) so dynamic height changes or infinite-scroll appends avoid full-list relayouts.
- **Sub-millisecond viewport queries**: Binary-searches each column independently in `O(log(N / C))` time and emits GPU-composited `translate3d(x, y, 0)` coordinates.
- **Scroll anchoring**: Compensates scroll position automatically when off-screen items above the viewport expand or collapse, preventing sudden visual jumps.
- **Velocity-aware directional overscan**: Dynamically biases lookahead buffer in the active scroll direction during fast mobile fling gestures.
- **Adaptive height estimation**: Refines unmeasured item estimates using a live rolling average of measured heights.

## Installation

```bash
npm install ashlar-grid
```

## Quick Start (Vanilla TypeScript / JavaScript)

```ts
import { createAshlarGrid } from 'ashlar-grid';

const scrollContainer = document.getElementById('scroller')!;
const gridContainer = document.getElementById('grid')!;

const items = Array.from({ length: 5000 }, (_, i) => ({
  id: `card-${i}`,
  title: `Item ${i}`
}));

const grid = createAshlarGrid({
  items,
  getItemKey: (_index, item) => item!.id,
  minColumnWidth: 260,
  gap: 16,
  overscan: 320,
  estimateHeight: 240
});

const mountedNodes = new Map<string | number, HTMLElement>();

function render() {
  const snapshot = grid.getSnapshot();
  gridContainer.style.height = `${snapshot.totalHeight}px`;
  gridContainer.style.position = 'relative';

  const activeKeys = new Set<string | number>();

  for (const virtualItem of snapshot.items) {
    activeKeys.add(virtualItem.key);
    let el = mountedNodes.get(virtualItem.key);

    if (!el) {
      el = document.createElement('article');
      el.textContent = virtualItem.data?.title ?? '';
      gridContainer.appendChild(el);
      mountedNodes.set(virtualItem.key, el);
      grid.measureElement(virtualItem.key, el);
    }

    el.style.position = virtualItem.style.position;
    el.style.top = '0px';
    el.style.left = '0px';
    el.style.width = virtualItem.style.width;
    el.style.transform = virtualItem.style.transform;
    el.style.willChange = virtualItem.style.willChange;
  }

  for (const [key, node] of mountedNodes) {
    if (!activeKeys.has(key)) {
      grid.measureElement(key, null);
      node.remove();
      mountedNodes.delete(key);
    }
  }
}

const unsubscribe = grid.subscribe(render);
const detachScroll = grid.attachScrollContainer(scrollContainer);
const detachGrid = grid.attachGridContainer(gridContainer);
render();
```

## React Integration Example

```tsx
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createAshlarGrid } from 'ashlar-grid';

export function MasonryFeed({ items }: { items: Array<{ id: string; body: string }> }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef(
    createAshlarGrid({
      items,
      getItemKey: (_index, item) => item!.id,
      minColumnWidth: 240,
      gap: 16
    })
  );

  useEffect(() => {
    engineRef.current.setItems(items);
  }, [items]);

  useEffect(() => {
    const engine = engineRef.current;
    const detachScroll = engine.attachScrollContainer(scrollRef.current);
    const detachGrid = engine.attachGridContainer(gridRef.current);
    return () => {
      detachScroll();
      detachGrid();
    };
  }, []);

  const snapshot = useSyncExternalStore(
    (cb) => engineRef.current.subscribe(cb),
    () => engineRef.current.getSnapshot(),
    () => engineRef.current.getSnapshot()
  );

  return (
    <div ref={scrollRef} style={{ height: '100vh', overflowY: 'auto' }}>
      <div ref={gridRef} style={{ position: 'relative', height: snapshot.totalHeight }}>
        {snapshot.items.map((item) => (
          <div
            key={item.key}
            ref={engineRef.current.createItemRef(item.key)}
            style={item.style}
          >
            {item.data?.body}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## API Reference

### `createAshlarGrid<T>(options?: GridOptions<T>): AshlarGrid<T>`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `items` | `readonly T[]` | `undefined` | Data array rendered by the grid. |
| `count` | `number` | `0` | Item count when managing data externally. |
| `getItemKey` | `(index, item) => ItemKey` | `index => index` | Stable key resolver for height caching and scroll anchoring. |
| `estimateHeight` | `number \| (index, columnWidth, item) => number` | `240` | Initial height estimate before DOM measurement. |
| `adaptiveEstimation` | `boolean` | `true` | Uses rolling average of measured heights for unmeasured items. |
| `columns` | `number` | `undefined` | Fixed column count (overrides responsive `minColumnWidth`). |
| `minColumnWidth` | `number` | `240` | Minimum column width used to compute responsive column count. |
| `maxColumns` | `number` | `24` | Upper bound for responsive or fixed column count. |
| `gap` | `number` | `16` | Shorthand for both `columnGap` and `rowGap`. |
| `columnGap` | `number` | `gap` | Horizontal spacing between columns in pixels. |
| `rowGap` | `number` | `gap` | Vertical spacing between items in a column in pixels. |
| `paddingStart` | `number` | `0` | Top inset inside the virtualized canvas. |
| `paddingEnd` | `number` | `0` | Bottom inset inside the virtualized canvas. |
| `overscan` | `number` | `320` | Base viewport buffer in pixels above and below the visible region. |
| `maxVelocityOverscan` | `number` | `640` | Maximum extra directional overscan applied during fast scrolling. |
| `heightEpsilon` | `number` | `0.5` | Sub-pixel tolerance to ignore jitter from `ResizeObserver`. |
| `checkpointInterval` | `number` | `64` | Placement checkpoint interval for incremental dirty-index reflows. |
| `scrollAnchor` | `boolean` | `true` | Preserves viewport stability when above-fold items resize. |
| `scrollingResetDelay` | `number` | `150` | Idle delay in milliseconds before `isScrolling` resets to `false`. |
| `onScrollCorrection` | `(deltaY: number) => void` | `undefined` | Callback invoked when scroll anchoring computes a delta. |
| `onRangeChange` | `(snapshot) => void` | `undefined` | Callback invoked whenever the visible snapshot updates. |

### Instance Methods

- `subscribe(listener)`: Registers a snapshot listener and returns an unsubscribe function.
- `getSnapshot()`: Returns the current immutable `VirtualGridSnapshot<T>`.
- `attachScrollContainer(target)`: Attaches passive RAF-throttled scroll and resize listeners to a scroll container or `window`.
- `attachGridContainer(element)`: Observes the grid container's inline size for responsive column recalculation.
- `measureElement(key, element)`: Starts or stops observing an item's DOM node with the shared `ResizeObserver`.
- `createItemRef(key)`: Returns a stable ref callback for React/framework element binding.
- `reportItemHeight(key, height)`: Manually reports an item's measured height.
- `reportContainerWidth(width)`: Manually updates the container width.
- `reportScroll(scrollTop, viewportHeight?)`: Manually updates scroll position and viewport height.
- `setItems(itemsOrCount)`: Replaces the active dataset or item count.
- `appendItems(itemsOrCount)`: Incrementally appends new items without reflowing prior checkpoints.
- `updateOptions(partial)`: Updates configuration options at runtime.
- `scrollToIndex(index, options?)`: Scrolls an item into view (`start`, `center`, `end`, or `auto`).
- `invalidateMeasurement(key?)`: Clears cached measured height for one key or all keys.
- `getItemPlacement(index)`: Returns computed coordinates for any index.
- `flush()`: Synchronously flushes pending resize and scroll batches.
- `destroy()`: Disconnects all observers, listeners, timers, and subscribers.

## License

MIT

---

<strong>A Sabtain Ali production</strong>