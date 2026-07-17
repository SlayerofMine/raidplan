import type { Stage as KonvaStage } from "konva/lib/Stage";

/**
 * A tiny registry for the live editor Konva `Stage` node.
 *
 * PNG export (plan §5.1) needs the stage to call `toDataURL`, but the export
 * action lives in the toolbar while the stage is created in `CanvasStage` — two
 * siblings with no shared ref. Rather than thread a ref through the whole shell
 * or park a non-serialisable Konva node in the store, `CanvasStage` registers
 * the node here on mount and the exporter reads it. Type-only Konva import, so
 * this stays safe to load under jsdom.
 */
let stageNode: KonvaStage | null = null;

export function setStageNode(node: KonvaStage | null): void {
  stageNode = node;
}

export function getStageNode(): KonvaStage | null {
  return stageNode;
}
