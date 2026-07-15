/**
 * Upload validation (plan §4.8 "validation & limits", §5.5 "upload safety").
 *
 * An upload endpoint is the most exposed thing in the app: it takes bytes from
 * a user and puts them on disk. So this is *pure* and exhaustively testable, and
 * everything it decides is based on the **content**, never on what the client
 * claimed:
 *
 *  - the `Content-Type` header is a claim, not evidence
 *  - so is the filename, and its extension
 *
 * We sniff magic bytes instead, and only accept raster formats. **SVG is
 * deliberately rejected**: it is a script-bearing document, and serving one
 * from our own origin would be stored XSS.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — a map, not a video

export type UploadKind = "png" | "jpeg" | "webp" | "gif";

export interface UploadInfo {
  kind: UploadKind;
  mimeType: string;
  extension: string;
}

export type UploadCheck =
  { ok: true; info: UploadInfo } | { ok: false; error: string };

const MIME: Record<UploadKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/** Identify a raster image from its magic bytes, or null if it isn't one. */
export function sniffImage(bytes: Uint8Array): UploadKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return null;
}

/** Validate an uploaded file's bytes. Size and type only — never the filename. */
export function validateUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Images must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    };
  }

  const kind = sniffImage(bytes);
  if (!kind) {
    // Covers SVG, HTML, scripts, zip bombs, and anything else pretending to be
    // an image via its Content-Type or extension.
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP or GIF images are accepted.",
    };
  }

  return {
    ok: true,
    info: {
      kind,
      mimeType: MIME[kind],
      extension: kind === "jpeg" ? "jpg" : kind,
    },
  };
}

/**
 * PNG and GIF carry their dimensions in the header; JPEG and WebP need a real
 * parse we don't do. Returns null when unknown — the caller must treat that as
 * "unknown", not "zero".
 */
export function readImageSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = sniffImage(bytes);

  try {
    if (kind === "png" && bytes.byteLength >= 24) {
      // IHDR is the first chunk: width/height are big-endian at 16 and 20.
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (kind === "gif" && bytes.byteLength >= 10) {
      return {
        width: view.getUint16(6, true),
        height: view.getUint16(8, true),
      };
    }
  } catch {
    return null;
  }
  return null;
}
