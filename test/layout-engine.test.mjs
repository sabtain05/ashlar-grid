import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MasonryLayoutEngine,
  clamp,
  computeOverscanBounds,
  findShortestColumn,
  lowerBoundByBottom,
  resolveColumnMetrics,
  upperBoundByTop
} from '../dist/index.js';

test('resolveColumnMetrics computes responsive and fixed columns accurately', () => {
  const responsive = resolveColumnMetrics(1000, {
    minColumnWidth: 240,
    maxColumns: 10,
    columnGap: 16
  });
  assert.equal(responsive.columnCount, 3);
  assert.equal(Math.round(responsive.columnWidth), 323);

  const fixed = resolveColumnMetrics(1000, {
    columns: 4,
    minColumnWidth: 240,
    maxColumns: 10,
    columnGap: 20
  });
  assert.equal(fixed.columnCount, 4);
  assert.equal(fixed.columnWidth, 235);

  const narrow = resolveColumnMetrics(120, {
    minColumnWidth: 240,
    maxColumns: 10,
    columnGap: 16
  });
  assert.equal(narrow.columnCount, 1);
  assert.equal(narrow.columnWidth, 120);
});

test('shortest-column placement packs variable heights evenly', () => {
  const heights = [300, 100, 200, 150, 120];
  const engine = new MasonryLayoutEngine({
    getItemKey: (i) => `k-${i}`,
    estimateHeight: (i) => heights[i],
    adaptiveEstimation: false,
    checkpointInterval: 2
  });
  engine.setGeometry(2, 200, 10, 10, 0, 0);
  engine.setItems(heights.length);

  const p0 = engine.getPlacement(0);
  const p1 = engine.getPlacement(1);
  const p2 = engine.getPlacement(2);
  const p3 = engine.getPlacement(3);
  const p4 = engine.getPlacement(4);

  assert.equal(p0.column, 0);
  assert.equal(p0.y, 0);
  assert.equal(p1.column, 1);
  assert.equal(p1.y, 0);
  assert.equal(p2.column, 1);
  assert.equal(p2.y, 110);
  assert.equal(p3.column, 0);
  assert.equal(p3.y, 310);
  assert.equal(p4.column, 1);
  assert.equal(p4.y, 320);
  assert.equal(engine.getTotalHeight(), 460);
});

test('checkpointed incremental reflow matches full scratch layout exactly', () => {
  const incremental = new MasonryLayoutEngine({
    getItemKey: (i) => i,
    estimateHeight: () => 100,
    adaptiveEstimation: false,
    checkpointInterval: 16
  });
  incremental.setGeometry(3, 200, 10, 10, 0, 0);
  incremental.setItems(200);
  const totalBefore = incremental.getTotalHeight();

  const result = incremental.setMeasuredHeight(100, 420, 0.5);
  assert.equal(result.changed, true);

  const updated = incremental.getPlacement(100);
  assert.equal(updated.height, 420);
  assert.equal(updated.measured, true);
  assert.ok(incremental.getTotalHeight() > totalBefore);

  const scratch = new MasonryLayoutEngine({
    getItemKey: (i) => i,
    estimateHeight: (i) => (i === 100 ? 420 : 100),
    adaptiveEstimation: false,
    checkpointInterval: 16
  });
  scratch.setGeometry(3, 200, 10, 10, 0, 0);
  scratch.setItems(200);

  assert.equal(incremental.getTotalHeight(), scratch.getTotalHeight());
  for (let i = 0; i < 200; i++) {
    const a = incremental.getPlacement(i);
    const b = scratch.getPlacement(i);
    assert.equal(a.column, b.column);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.height, b.height);
  }
});

test('appendItems extends layout incrementally without resetting measurements', () => {
  const engine = new MasonryLayoutEngine({
    getItemKey: (i) => `item-${i}`,
    estimateHeight: () => 120,
    adaptiveEstimation: false,
    checkpointInterval: 32
  });
  engine.setGeometry(3, 300, 12, 12, 0, 0);
  engine.setItems(50);
  engine.setMeasuredHeight('item-10', 340, 0.5);

  const heightBefore = engine.getTotalHeight();
  engine.appendItems(50);

  assert.equal(engine.getCount(), 100);
  assert.equal(engine.getPlacement(10).height, 340);
  assert.ok(engine.getTotalHeight() > heightBefore);
});

test('binary search viewport query returns exact intersecting items sorted by index', () => {
  const engine = new MasonryLayoutEngine({
    getItemKey: (i) => i,
    estimateHeight: (i) => 100 + (i % 5) * 30,
    adaptiveEstimation: false,
    checkpointInterval: 64
  });
  engine.setGeometry(4, 220, 16, 16, 0, 0);
  engine.setItems(1000);

  const minY = 5000;
  const maxY = 5800;
  const visible = engine.queryVisible(minY, maxY);

  assert.ok(visible.length > 0);
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    assert.ok(item.bottom > minY);
    assert.ok(item.y < maxY);
    if (i > 0) {
      assert.ok(item.index > visible[i - 1].index);
    }
  }
});

test('computeOverscanBounds biases lookahead in scroll direction', () => {
  const idle = computeOverscanBounds(1000, 800, 200, 0, 500);
  assert.equal(idle.minY, 800);
  assert.equal(idle.maxY, 2000);

  const forward = computeOverscanBounds(1000, 800, 200, 2.0, 500);
  assert.ok(forward.maxY > idle.maxY);

  const backward = computeOverscanBounds(1000, 800, 200, -2.0, 500);
  assert.ok(backward.minY < idle.minY);
});

test('math helper invariants hold for clamp, shortest column, and binary bounds', () => {
  assert.equal(clamp(5, 10, 20), 10);
  assert.equal(clamp(25, 10, 20), 20);
  assert.equal(clamp(15, 10, 20), 15);
  assert.equal(findShortestColumn(new Float64Array([300, 120, 250])), 1);

  const col = [
    { index: 0, key: 0, column: 0, x: 0, y: 0, width: 100, height: 100, bottom: 100, measured: true },
    { index: 1, key: 1, column: 0, x: 0, y: 110, width: 100, height: 100, bottom: 210, measured: true },
    { index: 2, key: 2, column: 0, x: 0, y: 220, width: 100, height: 100, bottom: 320, measured: true }
  ];
  assert.equal(lowerBoundByBottom(col, 100), 1);
  assert.equal(upperBoundByTop(col, 220), 2);
});
