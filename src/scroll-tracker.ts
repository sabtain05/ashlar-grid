import type {
  ScrollBehaviorMode,
  ScrollDirection,
  ScrollTargetLike
} from './types.js';

export interface ScrollState {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly velocity: number;
  readonly direction: ScrollDirection;
  readonly isScrolling: boolean;
}

export interface ScrollTrackerCallbacks {
  onScrollFrame: (state: ScrollState) => void;
}

function nowMs(): number {
  const globalObj = globalThis as unknown as {
    performance?: { now: () => number };
  };
  if (globalObj.performance && typeof globalObj.performance.now === 'function') {
    return globalObj.performance.now();
  }
  return Date.now();
}

function readTargetScrollTop(target: ScrollTargetLike): number {
  if (typeof target.scrollTop === 'number') {
    return target.scrollTop;
  }
  if (typeof target.scrollY === 'number') {
    return target.scrollY;
  }
  return 0;
}

function readTargetViewportHeight(target: ScrollTargetLike): number {
  if (typeof target.clientHeight === 'number' && target.clientHeight > 0) {
    return target.clientHeight;
  }
  if (typeof target.innerHeight === 'number' && target.innerHeight > 0) {
    return target.innerHeight;
  }
  return 0;
}

export class ScrollTracker {
  private callbacks: ScrollTrackerCallbacks;
  private target: ScrollTargetLike | null = null;
  private scrollTop: number;
  private viewportHeight: number;
  private velocity = 0;
  private direction: ScrollDirection = 'idle';
  private isScrolling = false;
  private lastTimestamp = 0;
  private scrollingResetDelay: number;

  private rafPending = false;
  private rafHandle: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private readonly boundOnScroll = (): void => {
    this.handleNativeScroll();
  };

  private readonly boundOnResize = (): void => {
    this.handleNativeResize();
  };

  constructor(
    callbacks: ScrollTrackerCallbacks,
    initial: {
      scrollTop: number;
      viewportHeight: number;
      scrollingResetDelay: number;
    }
  ) {
    this.callbacks = callbacks;
    this.scrollTop = Math.max(0, initial.scrollTop);
    this.viewportHeight = Math.max(0, initial.viewportHeight);
    this.scrollingResetDelay = Math.max(16, initial.scrollingResetDelay);
  }

  setScrollingResetDelay(delayMs: number): void {
    this.scrollingResetDelay = Math.max(16, delayMs);
  }

  attach(target: ScrollTargetLike | null): () => void {
    this.detach();
    if (!target || this.destroyed) {
      return () => {};
    }

    this.target = target;
    this.scrollTop = Math.max(0, readTargetScrollTop(target));
    const measuredViewport = readTargetViewportHeight(target);
    if (measuredViewport > 0) {
      this.viewportHeight = measuredViewport;
    }
    this.lastTimestamp = nowMs();

    target.addEventListener('scroll', this.boundOnScroll, { passive: true });
    target.addEventListener('resize', this.boundOnResize, { passive: true });

    this.callbacks.onScrollFrame(this.getState());

    return () => {
      if (this.target === target) {
        this.detach();
      }
    };
  }

  detach(): void {
    if (this.target) {
      this.target.removeEventListener('scroll', this.boundOnScroll);
      this.target.removeEventListener('resize', this.boundOnResize);
      this.target = null;
    }
    this.cancelScheduledFrame();
    this.clearIdleTimer();
  }

  setManualScroll(scrollTop: number, viewportHeight?: number, timestamp?: number): void {
    if (this.destroyed) return;
    const nextScrollTop = Math.max(0, scrollTop);
    const nextViewport =
      viewportHeight !== undefined ? Math.max(0, viewportHeight) : this.viewportHeight;
    const ts = timestamp ?? nowMs();

    this.updateVelocityAndPosition(nextScrollTop, nextViewport, ts);
    this.callbacks.onScrollFrame(this.getState());
  }

  applyScrollCorrection(deltaY: number): void {
    if (this.destroyed || Math.abs(deltaY) < 0.5) return;

    const nextTop = Math.max(0, this.scrollTop + deltaY);
    this.scrollTop = nextTop;

    if (this.target) {
      if (typeof this.target.scrollBy === 'function') {
        this.target.scrollBy({ top: deltaY, behavior: 'instant' });
      } else if (typeof this.target.scrollTo === 'function') {
        this.target.scrollTo({ top: nextTop, behavior: 'instant' });
      } else if (typeof this.target.scrollTop === 'number') {
        this.target.scrollTop = nextTop;
      }
    }
  }

  scrollTo(top: number, behavior: ScrollBehaviorMode = 'auto'): void {
    if (this.destroyed) return;
    const safeTop = Math.max(0, top);
    this.scrollTop = safeTop;

    if (this.target) {
      if (typeof this.target.scrollTo === 'function') {
        this.target.scrollTo({ top: safeTop, behavior });
      } else if (typeof this.target.scrollTop === 'number') {
        this.target.scrollTop = safeTop;
      }
    }

    this.callbacks.onScrollFrame(this.getState());
  }

  getState(): ScrollState {
    return {
      scrollTop: this.scrollTop,
      viewportHeight: this.viewportHeight,
      velocity: this.velocity,
      direction: this.direction,
      isScrolling: this.isScrolling
    };
  }

  flush(): void {
    if (!this.rafPending || this.destroyed) return;
    this.cancelScheduledFrame();
    this.syncFromTarget();
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
  }

  private handleNativeScroll(): void {
    if (this.destroyed || this.rafPending) return;
    this.rafPending = true;

    const globalObj = globalThis as unknown as {
      requestAnimationFrame?: (cb: () => void) => number;
    };

    if (typeof globalObj.requestAnimationFrame === 'function') {
      this.rafHandle = globalObj.requestAnimationFrame(() => {
        this.rafPending = false;
        this.rafHandle = null;
        this.syncFromTarget();
      });
    } else {
      queueMicrotask(() => {
        if (!this.rafPending || this.destroyed) return;
        this.rafPending = false;
        this.syncFromTarget();
      });
    }
  }

  private handleNativeResize(): void {
    if (!this.target || this.destroyed) return;
    const nextViewport = readTargetViewportHeight(this.target);
    if (nextViewport > 0 && Math.abs(nextViewport - this.viewportHeight) > 0.5) {
      this.viewportHeight = nextViewport;
      this.callbacks.onScrollFrame(this.getState());
    }
  }

  private syncFromTarget(): void {
    if (!this.target || this.destroyed) return;
    const nextScrollTop = Math.max(0, readTargetScrollTop(this.target));
    const measuredViewport = readTargetViewportHeight(this.target);
    const nextViewport = measuredViewport > 0 ? measuredViewport : this.viewportHeight;
    this.updateVelocityAndPosition(nextScrollTop, nextViewport, nowMs());
    this.callbacks.onScrollFrame(this.getState());
  }

  private updateVelocityAndPosition(
    nextScrollTop: number,
    nextViewport: number,
    timestamp: number
  ): void {
    const deltaY = nextScrollTop - this.scrollTop;
    const deltaT = Math.max(1, timestamp - (this.lastTimestamp || timestamp));

    if (Math.abs(deltaY) > 0.01) {
      const instantVelocity = deltaY / deltaT;
      this.velocity = this.velocity * 0.65 + instantVelocity * 0.35;
      this.direction = deltaY > 0 ? 'forward' : 'backward';
      this.isScrolling = true;
      this.resetIdleTimer();
    }

    this.scrollTop = nextScrollTop;
    this.viewportHeight = nextViewport;
    this.lastTimestamp = timestamp;
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.destroyed) return;
      this.isScrolling = false;
      this.velocity = 0;
      this.direction = 'idle';
      this.callbacks.onScrollFrame(this.getState());
    }, this.scrollingResetDelay);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private cancelScheduledFrame(): void {
    if (this.rafHandle !== null) {
      const globalObj = globalThis as unknown as {
        cancelAnimationFrame?: (id: number) => void;
      };
      if (typeof globalObj.cancelAnimationFrame === 'function') {
        globalObj.cancelAnimationFrame(this.rafHandle);
      }
      this.rafHandle = null;
    }
    this.rafPending = false;
  }
}
