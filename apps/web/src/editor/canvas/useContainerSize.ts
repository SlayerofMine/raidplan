import { useEffect, useRef, useState, type RefObject } from "react";
import type { Size } from "./coords";

/**
 * Measure a container's content-box size, kept current via `ResizeObserver`.
 * The canvas uses this to size the Konva stage and to recompute fit-to-screen,
 * so the plan stays stable across window/panel resizes (plan §1.2 acceptance).
 */
export function useContainerSize<T extends HTMLElement>(): [
  RefObject<T>,
  Size,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = (w: number, h: number) => {
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      );
    };

    update(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      update(width, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/**
 * Konva stage dimensions for a container that may not be measured yet.
 *
 * A stage sized 0×0 gets a 0×0 `bufferCanvas`, and any shape that needs the
 * buffer — fill *and* stroke under an opacity below 1, which is every
 * translucent zone and attack shape — ends its draw with
 * `context.drawImage(bufferCanvas)`. Firefox throws `InvalidStateError:
 * Passed-in canvas is empty` on a zero-sized source, and since the draw happens
 * inside React's commit it takes the whole editor down rather than one shape.
 *
 * The first frame is *always* unmeasured: react-konva mounts and draws the
 * stage during the commit's mutation phase, before the effect above ever runs.
 * It only crashes when the plan's objects are already in the store at that
 * moment — a client-side navigation into the editor with a warm cache, not a
 * cold reload, which is why the bug looks like it "fixes itself" on refresh.
 *
 * Clamping to one pixel is invisible (the real size lands on the next frame)
 * and keeps the stage mounted, which unmounting on a zero measurement — from a
 * collapsed panel, say — would not.
 */
export function stageSize(size: Size): Size {
  return {
    width: Math.max(size.width, 1),
    height: Math.max(size.height, 1),
  };
}
