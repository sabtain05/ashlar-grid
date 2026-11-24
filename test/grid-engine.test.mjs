import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAshlarGrid } from '../dist/index.js';

class MockResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    MockResizeObserver.instances.push(this);
  }

  observe(target) {
    this.observed.add(target);
  }

  unobserve(target) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  triggerHeight(target, height) {
    this.callback([
      {
        target,
        contentRect: { width: 300, height },
        borderBoxSize: [{ inlineSize: 300, blockSize: height }]
      }
    ]);
  }
}

test('AshlarGrid virtualizes only viewport + overscan items and updates on scroll', () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: `card-${i}`, idx: i }));
  const grid = createAshlarGrid({
    items,
    getItemKey: (_i, item) => item.id,
    columns: 4,
    gap: 16,
    estimateHeight: 200,
    overscan: 200,
    initialContainerWidth: 1000,
    initialViewportHeight: 600
  });

  const initial = grid.getSnapshot();
  assert.equal(initial.totalCount, 1000);
  assert.equal(initial.columnCount, 4);
  assert.ok(initial.items.length < 40);
  assert.ok(initial.items.length >= 12);
  assert.equal(initial.items[0].style.position, 'absolute');
  assert.ok(initial.items[0].style.transform.startsWith('translate3d('));

  grid.reportScroll(4000);
  const scrolled = grid.getSnapshot();
  assert.ok(scrolled.visibleRange.startIndex > 40);
  assert.ok(scrolled.items.every((item) => item.bottom > 3600));

  grid.destroy();
});

test('AshlarGrid compensates scrollTop via scroll anchoring when above-fold items expand', () => {
  const corrections = [];
  const grid = createAshlarGrid({
    count: 200,
    columns: 2,
    gap: 10,
    estimateHeight: 150,
    adaptiveEstimation: false,
    overscan: 100,
    initialContainerWidth: 610,
    initialViewportHeight: 500,
    onScrollCorrection: (delta) => corrections.push(delta)
  });

  grid.reportScroll(1200);
  const anchorBefore = grid.getSnapshot().items.find((item) => item.bottom > 1200);
  assert.ok(anchorBefore);
  const relativeOffsetBefore = 1200 - anchorBefore.y;

  grid.reportItemHeight(0, 450);

  assert.equal(corrections.length, 1);
  assert.ok(corrections[0] > 0);

  const anchorAfter = grid.getItemPlacement(anchorBefore.index);
  const scrollAfter = grid.getSnapshot().scrollTop;
  const relativeOffsetAfter = scrollAfter - anchorAfter.y;

  assert.ok(Math.abs(relativeOffsetAfter - relativeOffsetBefore) < 0.01);

  grid.destroy();
});

test('AshlarGrid integrates raw ResizeObserver through createItemRef', () => {
  MockResizeObserver.instances = [];
  const grid = createAshlarGrid({
    count: 50,
    columns: 3,
    gap: 12,
    estimateHeight: 180,
    adaptiveEstimation: false,
    initialContainerWidth: 924,
    initialViewportHeight: 600,
    resizeObserverConstructor: MockResizeObserver
  });

  const notifications = [];
  const unsubscribe = grid.subscribe((snap) => notifications.push(snap));

  const fakeNode = { clientWidth: 300 };
  const refCb = grid.createItemRef(0);
  refCb(fakeNode);

  assert.equal(MockResizeObserver.instances.length, 1);
  MockResizeObserver.instances[0].triggerHeight(fakeNode, 420);
  grid.flush();

  const p0 = grid.getItemPlacement(0);
  assert.equal(p0.height, 420);
  assert.equal(p0.measured, true);
  assert.ok(notifications.length >= 1);

  refCb(null);
  unsubscribe();
  grid.destroy();
});

test('AshlarGrid scrollToIndex supports start, center, end, and auto alignment', () => {
  const grid = createAshlarGrid({
    count: 300,
    columns: 3,
    gap: 10,
    estimateHeight: 200,
    initialContainerWidth: 920,
    initialViewportHeight: 600
  });

  const targetStart = grid.scrollToIndex(60, { align: 'start' });
  const placement = grid.getItemPlacement(60);
  assert.equal(targetStart, placement.y);
  assert.equal(grid.getSnapshot().scrollTop, placement.y);

  const targetCenter = grid.scrollToIndex(90, { align: 'center' });
  const p90 = grid.getItemPlacement(90);
  assert.equal(targetCenter, p90.y - (600 - p90.height) / 2);

  grid.destroy();
});

test('AshlarGrid handles 10,000 items within sub-millisecond scroll frame budget', () => {
  const grid = createAshlarGrid({
    count: 10000,
    columns: 5,
    gap: 16,
    estimateHeight: (i) => 160 + (i % 7) * 28,
    adaptiveEstimation: false,
    initialContainerWidth: 1400,
    initialViewportHeight: 900
  });

  grid.getSnapshot();

  const start = performance.now();
  for (let i = 0; i < 60; i++) {
    grid.reportScroll(i * 500);
  }
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 100, `Expected 60 scroll frames under 100ms, got ${elapsed.toFixed(2)}ms`);
  grid.destroy();
});

test('CommonJS bundle exports identical API surface', () => {
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/index.cjs');

  assert.equal(typeof cjs.createAshlarGrid, 'function');
  assert.equal(typeof cjs.AshlarGrid, 'function');
  assert.equal(typeof cjs.MasonryLayoutEngine, 'function');
  assert.equal(typeof cjs.ResizeTracker, 'function');
  assert.equal(typeof cjs.ScrollTracker, 'function');

  const grid = cjs.createAshlarGrid({ count: 20, columns: 2, initialContainerWidth: 600 });
  assert.equal(grid.getSnapshot().totalCount, 20);
  grid.destroy();
});
