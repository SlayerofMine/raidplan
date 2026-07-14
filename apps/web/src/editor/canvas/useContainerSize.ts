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
