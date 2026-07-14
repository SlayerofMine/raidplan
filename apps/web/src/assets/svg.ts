/**
 * Encode an inline SVG string as a `data:` URI usable as an `<img>`/Konva image
 * source. `encodeURIComponent` (not base64) keeps it human-readable in devtools
 * and avoids a Buffer dependency in the browser bundle.
 */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
