import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollTracker } from '../dist/index.js';

function createMockScrollTarget(initialTop = 0, clientHeight = 800) {
  const listeners = new Map();
  return {
    scrollTop: initialTop,
    clientHeight,
    scrollCalls: [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    scrollBy(opts) {
      this.scrollTop = Math.max(0, this.scrollTop + opts.top);
      this.scrollCalls.push(opts);
    },
    scrollTo(opts) {
      this.scrollTop = Math.max(0, opts.top);
      this.scrollCalls.push(opts);
    },
    dispatch(type) {
      for (const fn of listeners.get(type) ?? []) {
        fn();
      }
    }
  };
}

test('ScrollTracker tracks passive scroll events, velocity, direction, and corrections', () => {
  const frames = [];
  const tracker = new ScrollTracker(
    {
      onScrollFrame: (state) => frames.push(state)
    },
    {
      scrollTop: 0,
      viewportHeight: 800,
      scrollingResetDelay: 40
    }
  );

  const target = createMockScrollTarget(0, 800);
  const detach = tracker.attach(target);
  assert.equal(frames.length, 1);

  target.scrollTop = 450;
  target.dispatch('scroll');
  tracker.flush();

  const afterScroll = tracker.getState();
  assert.equal(afterScroll.scrollTop, 450);
  assert.equal(afterScroll.direction, 'forward');
  assert.equal(afterScroll.isScrolling, true);
  assert.ok(afterScroll.velocity > 0);

  tracker.applyScrollCorrection(80);
  assert.equal(target.scrollTop, 530);
  assert.equal(tracker.getState().scrollTop, 530);

  detach();
  tracker.destroy();
});
