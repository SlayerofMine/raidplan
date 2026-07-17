import { describe, expect, it, vi } from "vitest";
import {
  capturePlanPng,
  downloadDataUrl,
  exportStepFileName,
  type CapturableStage,
} from "./pngExport";

describe("exportStepFileName", () => {
  it("names the base layout and numbered steps, slugified", () => {
    expect(exportStepFileName("Raid Night!", -1)).toBe("raid-night-base.png");
    expect(exportStepFileName("Raid Night!", 0)).toBe("raid-night-step-1.png");
    expect(exportStepFileName("Raid Night!", 2)).toBe("raid-night-step-3.png");
  });

  it("falls back to a default slug for an empty title", () => {
    expect(exportStepFileName("   ", 0)).toBe("plan-step-1.png");
  });
});

describe("capturePlanPng", () => {
  it("captures the plan's native rect and cancels the zoom via pixelRatio", () => {
    let received: Parameters<CapturableStage["toDataURL"]>[0] | undefined;
    const stage: CapturableStage = {
      toDataURL: (config) => {
        received = config;
        return "data:image/png;base64,XYZ";
      },
    };

    const url = capturePlanPng(
      stage,
      { width: 1600, height: 900 },
      { x: 10, y: 20, scale: 0.5 },
    );

    expect(url).toBe("data:image/png;base64,XYZ");
    expect(received).toEqual({
      x: 10,
      y: 20,
      width: 800, // 1600 * 0.5
      height: 450, // 900 * 0.5
      pixelRatio: 2, // 1 / 0.5 → native resolution
      mimeType: "image/png",
    });
  });
});

describe("downloadDataUrl", () => {
  it("clicks an anchor carrying the data URL and file name", () => {
    const anchor = document.createElement("a");
    const click = vi.spyOn(anchor, "click").mockImplementation(() => {});
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValueOnce(anchor);

    downloadDataUrl("data:image/png;base64,AAA", "raid-base.png");

    expect(anchor.getAttribute("href")).toBe("data:image/png;base64,AAA");
    expect(anchor.download).toBe("raid-base.png");
    expect(click).toHaveBeenCalledOnce();
    create.mockRestore();
  });
});
