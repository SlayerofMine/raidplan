// Vitest global setup for component tests: register jest-dom matchers (typed
// for vitest) and unmount React trees between tests to keep them isolated.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom implements no layout engine and ships no `ResizeObserver`, so anything
 * that measures its container (the virtualized icon palette, the canvas
 * container) would observe nothing and render empty. Report one deterministic
 * viewport instead; real measurement is covered by the Playwright E2E suite.
 */
const TEST_VIEWPORT = { width: 240, height: 480 };

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          borderBoxSize: [
            {
              inlineSize: TEST_VIEWPORT.width,
              blockSize: TEST_VIEWPORT.height,
            },
          ],
          contentBoxSize: [
            {
              inlineSize: TEST_VIEWPORT.width,
              blockSize: TEST_VIEWPORT.height,
            },
          ],
          contentRect: {
            ...TEST_VIEWPORT,
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: TEST_VIEWPORT.width,
            bottom: TEST_VIEWPORT.height,
            toJSON: () => ({}),
          },
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock;

afterEach(() => {
  cleanup();
});
