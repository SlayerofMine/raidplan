import { useEffect, useState } from "react";

/**
 * Load an image `src` into an `HTMLImageElement` for Konva, returning it once
 * decoded (or `undefined` while loading / when `src` is absent). One element per
 * call site for Phase 1; a shared icon cache / sprite atlas is Phase 2.1 (§8.5).
 */
export function useImageElement(
  src: string | undefined,
): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>();

  useEffect(() => {
    if (!src) {
      setImage(undefined);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return image;
}
