import { useEffect, useRef, useState } from "react";

/** How often the readout refreshes. Long enough to be stable, short enough to react. */
const SAMPLE_MS = 500;

/**
 * A frame-rate meter (plan §3.7 / §8.11 "add an FPS meter").
 *
 * Deliberately samples on an interval rather than setting state per frame —
 * a meter that re-rendered every frame would be measuring itself.
 */
export function useFps(enabled = true): number {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const since = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    since.current = performance.now();
    frames.current = 0;

    const tick = () => {
      frames.current += 1;
      const now = performance.now();
      const elapsed = now - since.current;
      if (elapsed >= SAMPLE_MS) {
        setFps(Math.round((frames.current * 1000) / elapsed));
        frames.current = 0;
        since.current = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return fps;
}
