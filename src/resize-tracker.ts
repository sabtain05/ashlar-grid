import type {
  ElementLike,
  ItemKey,
  ResizeObserverConstructorLike,
  ResizeObserverEntryLike,
  ResizeObserverLike
} from './types.js';

export interface ResizeTrackerCallbacks {
  onItemHeightsBatch: (heights: ReadonlyMap<ItemKey, number>) => void;
  onContainerWidth: (width: number) => void;
}

function getDefaultResizeObserver(): ResizeObserverConstructorLike | null {
  const globalObj = globalThis as unknown as {
    ResizeObserver?: ResizeObserverConstructorLike;
  };
  return typeof globalObj.ResizeObserver === 'function' ? globalObj.ResizeObserver : null;
}

function scheduleFrame(fn: () => void): { cancel: () => void } {
  const globalObj = globalThis as unknown as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };

  if (typeof globalObj.requestAnimationFrame === 'function') {
    const id = globalObj.requestAnimationFrame(fn);
    return {
      cancel: () => {
        if (typeof globalObj.cancelAnimationFrame === 'function') {
          globalObj.cancelAnimationFrame(id);
        }
      }
    };
  }

  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) fn();
  });
  return {
    cancel: () => {
      cancelled = true;
    }
  };
}

function extractEntryHeight(entry: ResizeObserverEntryLike): number {
  const borderBox = entry.borderBoxSize;
  if (borderBox && borderBox.length > 0 && Number.isFinite(borderBox[0].blockSize)) {
    return borderBox[0].blockSize;
  }
  return entry.contentRect.height;
}

function extractEntryWidth(entry: ResizeObserverEntryLike): number {
  const borderBox = entry.borderBoxSize;
  if (borderBox && borderBox.length > 0 && Number.isFinite(borderBox[0].inlineSize)) {
    return borderBox[0].inlineSize;
  }
  return entry.contentRect.width;
}

export class ResizeTracker {
  private callbacks: ResizeTrackerCallbacks;
  private observerCtor: ResizeObserverConstructorLike | null;
  private itemObserver: ResizeObserverLike | null = null;
  private containerObserver: ResizeObserverLike | null = null;

  private elementToKey = new WeakMap<ElementLike, ItemKey>();
  private keyToElement = new Map<ItemKey, ElementLike>();
  private containerElement: ElementLike | null = null;

  private pendingHeights = new Map<ItemKey, number>();
  private pendingContainerWidth: number | null = null;
  private scheduledFlush: { cancel: () => void } | null = null;
  private destroyed = false;

  constructor(
    callbacks: ResizeTrackerCallbacks,
    observerCtor?: ResizeObserverConstructorLike
  ) {
    this.callbacks = callbacks;
    this.observerCtor = observerCtor ?? getDefaultResizeObserver();
  }

  observeItem(key: ItemKey, element: ElementLike | null): void {
    if (this.destroyed) return;

    const existing = this.keyToElement.get(key);
    if (existing === element) return;

    if (existing) {
      this.itemObserver?.unobserve(existing);
      this.elementToKey.delete(existing);
      this.keyToElement.delete(key);
    }

    if (!element) return;

    const previousKeyForElement = this.elementToKey.get(element);
    if (previousKeyForElement !== undefined && previousKeyForElement !== key) {
      this.keyToElement.delete(previousKeyForElement);
    }

    this.elementToKey.set(element, key);
    this.keyToElement.set(key, element);

    const observer = this.ensureItemObserver();
    if (observer) {
      observer.observe(element, { box: 'border-box' });
    } else {
      const fallbackHeight = this.readElementHeight(element);
      if (fallbackHeight !== null) {
        this.pendingHeights.set(key, fallbackHeight);
        this.requestFlush();
      }
    }
  }

  unobserveItem(key: ItemKey): void {
    const element = this.keyToElement.get(key);
    if (!element) return;
    this.itemObserver?.unobserve(element);
    this.elementToKey.delete(element);
    this.keyToElement.delete(key);
    this.pendingHeights.delete(key);
  }

  unobserveElement(element: ElementLike): void {
    const key = this.elementToKey.get(element);
    if (key !== undefined) {
      this.keyToElement.delete(key);
      this.pendingHeights.delete(key);
    }
    this.elementToKey.delete(element);
    this.itemObserver?.unobserve(element);
  }

  observeContainer(element: ElementLike | null): void {
    if (this.destroyed) return;
    if (this.containerElement === element) return;

    if (this.containerElement) {
      this.containerObserver?.unobserve(this.containerElement);
      this.containerElement = null;
    }

    if (!element) return;

    this.containerElement = element;
    const observer = this.ensureContainerObserver();
    if (observer) {
      observer.observe(element, { box: 'border-box' });
    }

    const immediateWidth = this.readElementWidth(element);
    if (immediateWidth !== null && immediateWidth > 0) {
      this.callbacks.onContainerWidth(immediateWidth);
    }
  }

  flush(): void {
    if (this.scheduledFlush) {
      this.scheduledFlush.cancel();
      this.scheduledFlush = null;
    }

    if (this.destroyed) return;

    if (this.pendingContainerWidth !== null) {
      const width = this.pendingContainerWidth;
      this.pendingContainerWidth = null;
      this.callbacks.onContainerWidth(width);
    }

    if (this.pendingHeights.size > 0) {
      const batch = new Map(this.pendingHeights);
      this.pendingHeights.clear();
      this.callbacks.onItemHeightsBatch(batch);
    }
  }

  getObservedItemCount(): number {
    return this.keyToElement.size;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scheduledFlush) {
      this.scheduledFlush.cancel();
      this.scheduledFlush = null;
    }
    this.itemObserver?.disconnect();
    this.containerObserver?.disconnect();
    this.itemObserver = null;
    this.containerObserver = null;
    this.keyToElement.clear();
    this.pendingHeights.clear();
    this.containerElement = null;
    this.pendingContainerWidth = null;
  }

  private ensureItemObserver(): ResizeObserverLike | null {
    if (this.itemObserver) return this.itemObserver;
    if (!this.observerCtor) return null;

    this.itemObserver = new this.observerCtor((entries) => {
      if (this.destroyed) return;
      let queued = false;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const key = this.elementToKey.get(entry.target);
        if (key === undefined) continue;
        const height = extractEntryHeight(entry);
        if (Number.isFinite(height) && height >= 0) {
          this.pendingHeights.set(key, height);
          queued = true;
        }
      }
      if (queued) {
        this.requestFlush();
      }
    });

    return this.itemObserver;
  }

  private ensureContainerObserver(): ResizeObserverLike | null {
    if (this.containerObserver) return this.containerObserver;
    if (!this.observerCtor) return null;

    this.containerObserver = new this.observerCtor((entries) => {
      if (this.destroyed) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.target !== this.containerElement) continue;
        const width = extractEntryWidth(entry);
        if (Number.isFinite(width) && width >= 0) {
          this.pendingContainerWidth = width;
          this.requestFlush();
        }
      }
    });

    return this.containerObserver;
  }

  private requestFlush(): void {
    if (this.scheduledFlush || this.destroyed) return;
    this.scheduledFlush = scheduleFrame(() => {
      this.scheduledFlush = null;
      this.flush();
    });
  }

  private readElementHeight(element: ElementLike): number | null {
    if (typeof element.offsetHeight === 'number') {
      return element.offsetHeight;
    }
    if (typeof element.getBoundingClientRect === 'function') {
      return element.getBoundingClientRect().height;
    }
    return null;
  }

  private readElementWidth(element: ElementLike): number | null {
    if (typeof element.clientWidth === 'number' && element.clientWidth > 0) {
      return element.clientWidth;
    }
    if (typeof element.getBoundingClientRect === 'function') {
      return element.getBoundingClientRect().width;
    }
    return null;
  }
}
