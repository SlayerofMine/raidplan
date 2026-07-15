import { useEffect, useState } from "react";

/**
 * One `HTMLImageElement` per unique source, shared by every node that draws it
 * (plan §8.5: "One Image per icon, reused"). A 30-token board with 8 distinct
 * markers therefore decodes 8 images, not 30. A sprite atlas would be the next
 * step if the manifest ever grows past a few hundred icons.
 */
const cache = new Map<string, HTMLImageElement>();

/**
 * Get — creating on first use — the shared image element for a source. Kept
 * separate from the hook so the caching contract is unit-testable without a
 * real image decode (jsdom loads no resources).
 */
export function getImageElement(src: string): HTMLImageElement {
  let element = cache.get(src);
  if (!element) {
    element = new window.Image();
    cache.set(src, element);
    element.src = src;
  }
  return element;
}

/** Test seam: drop the cache so suites don't leak images between cases. */
export function clearImageCache(): void {
  cache.clear();
}

/**
 * Subscribe to the shared image for `src`, returning it once decoded (or
 * `undefined` while loading / when `src` is absent).
 */
export function useImageElement(
  src: string | undefined,
): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);

  useEffect(() => {
    if (!src) {
      setImage(undefined);
      return;
    }

    const element = getImageElement(src);
    if (element.complete) {
      setImage(element);
      return;
    }

    let cancelled = false;
    const onLoad = () => {
      if (!cancelled) setImage(element);
    };
    element.addEventListener("load", onLoad);
    return () => {
      cancelled = true;
      element.removeEventListener("load", onLoad);
    };
  }, [src]);

  return image;
}
