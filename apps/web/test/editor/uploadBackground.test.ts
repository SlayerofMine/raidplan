import { describe, expect, it, vi } from "vitest";
import {
  uploadBackground,
  UploadError,
} from "../../src/editor/uploadBackground";

const file = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "map.png", {
    type: "image/png",
  });

/** A fetch stub answering /api/upload with [status, body]. */
const stubFetch = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;

/**
 * jsdom doesn't decode images, so `new Image()` never fires load. Drive the
 * handlers directly — measurement in a real browser is covered by the E2E
 * suite.
 */
function stubImageDecode(size: { width: number; height: number } | "error") {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = size === "error" ? 0 : size.width;
    naturalHeight = size === "error" ? 0 : size.height;
    set src(_value: string) {
      queueMicrotask(() =>
        size === "error" ? this.onerror?.() : this.onload?.(),
      );
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

describe("uploadBackground", () => {
  it("returns a Background whose assetId is the served path", async () => {
    stubImageDecode({ width: 1600, height: 900 });
    const background = await uploadBackground(
      file(),
      stubFetch(201, { url: "/uploads/abc.png", width: 0, height: 0 }),
    );

    // The id *is* the URL: the plan stays self-contained.
    expect(background).toEqual({
      assetId: "/uploads/abc.png",
      width: 1600,
      height: 900,
    });
  });

  it("measures the image itself rather than trusting the server", async () => {
    // The server only parses PNG/GIF headers and answers 0 for JPEG/WebP —
    // but Background requires positive dimensions, and the coordinate system
    // is defined in the map's native pixels.
    stubImageDecode({ width: 800, height: 600 });
    const background = await uploadBackground(
      file(),
      stubFetch(201, { url: "/uploads/photo.jpg", width: 0, height: 0 }),
    );
    expect(background.width).toBe(800);
    expect(background.height).toBe(600);
  });

  it("surfaces the server's own message when it refuses the file", async () => {
    stubImageDecode({ width: 1, height: 1 });
    await expect(
      uploadBackground(
        file(),
        stubFetch(400, {
          error: "Only PNG, JPEG, WebP or GIF images are accepted.",
        }),
      ),
    ).rejects.toThrow(/PNG, JPEG, WebP or GIF/);
  });

  it("asks the user to sign in on a 401", async () => {
    stubImageDecode({ width: 1, height: 1 });
    await expect(uploadBackground(file(), stubFetch(401, {}))).rejects.toThrow(
      /Sign in/i,
    );
  });

  it("reports a plain failure when the server says nothing useful", async () => {
    stubImageDecode({ width: 1, height: 1 });
    await expect(uploadBackground(file(), stubFetch(500, {}))).rejects.toThrow(
      UploadError,
    );
  });

  it("fails when the stored file can't be decoded", async () => {
    stubImageDecode("error");
    await expect(
      uploadBackground(file(), stubFetch(201, { url: "/uploads/broken.png" })),
    ).rejects.toThrow(/couldn't be loaded/i);
  });

  it("sends credentials, or the authenticated endpoint would reject it", async () => {
    stubImageDecode({ width: 10, height: 10 });
    const fetchSpy = stubFetch(201, { url: "/uploads/a.png" });
    await uploadBackground(file(), fetchSpy);

    const init = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });
});
