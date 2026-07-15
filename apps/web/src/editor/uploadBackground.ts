import { type Background } from "@raidplan/shared";

/**
 * Upload a custom map and turn it into a plan `Background` (plan §4.8).
 *
 * The server validates the bytes, stores the file and answers with the path it
 * will be served from — that path *is* the background's `assetId`, so a plan
 * stays self-contained.
 *
 * Dimensions are measured **here**, not taken from the server: it only reads
 * PNG/GIF headers (JPEG and WebP need a real decoder), while the browser
 * decodes every format anyway. And `Background` requires *positive* dimensions,
 * so "unknown" is not an option — the whole coordinate system is defined in the
 * map's native pixels (plan §5).
 */
export interface UploadResult {
  background: Background;
}

/** Thrown with the server's own message, which is written for a human. */
export class UploadError extends Error {}

export async function uploadBackground(
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<Background> {
  const form = new FormData();
  form.set("file", file);

  const res = await fetchImpl("/api/upload", {
    method: "POST",
    body: form,
    // The endpoint is authenticated; without this the cookie isn't sent.
    credentials: "include",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new UploadError(
      body.error ??
        (res.status === 401
          ? "Sign in to upload a map."
          : "That upload failed."),
    );
  }

  const { url } = (await res.json()) as { url: string };
  const { width, height } = await measureImage(url);
  return { assetId: url, width, height };
}

/** Read an image's intrinsic size by letting the browser decode it. */
export function measureImage(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new UploadError("That image has no usable dimensions."));
      }
    };
    image.onerror = () =>
      reject(new UploadError("That image couldn't be loaded."));
    image.src = src;
  });
}
