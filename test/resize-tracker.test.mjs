import test from 'node:test';
import assert from 'node:assert/strict';
import { ResizeTracker } from '../dist/index.js';

class MockResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    this.disconnected = false;
    MockResizeObserver.instances.push(this);
  }

  observe(target) {
    this.observed.add(target);
  }

  unobserve(target) {
    this.observed.delete(target);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  emit(entries) {
    this.callback(entries);
  }
}

test('ResizeTracker shares one observer across all items and batches height updates', () => {
  MockResizeObserver.instances = [];
  const batches = [];
  let containerWidth = 0;

  const tracker = new ResizeTracker(
    {
      onItemHeightsBatch: (heights) => batches.push(heights),
      onContainerWidth: (w) => {
        containerWidth = w;
      }
    },
    MockResizeObserver
  );

  const elA = { clientWidth: 200 };
  const elB = { clientWidth: 200 };
  const container = { clientWidth: 960 };

  tracker.observeContainer(container);
  assert.equal(containerWidth, 960);

  tracker.observeItem('a', elA);
  tracker.observeItem('b', elB);

  assert.equal(tracker.getObservedItemCount(), 2);
  assert.equal(MockResizeObserver.instances.length, 2);

  const itemObserver = MockResizeObserver.instances[1];
  itemObserver.emit([
    { target: elA, contentRect: { width: 200, height: 180 }, borderBoxSize: [{ inlineSize: 200, blockSize: 196 }] },
    { target: elB, contentRect: { width: 200, height: 240 } }
  ]);

  tracker.flush();

  assert.equal(batches.length, 1);
  assert.equal(batches[0].get('a'), 196);
  assert.equal(batches[0].get('b'), 240);

  tracker.unobserveItem('a');
  assert.equal(tracker.getObservedItemCount(), 1);
  assert.equal(itemObserver.observed.has(elA), false);

  tracker.destroy();
  assert.equal(itemObserver.disconnected, true);
  assert.equal(tracker.getObservedItemCount(), 0);
});
