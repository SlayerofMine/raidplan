import { type Page } from "@playwright/test";

/**
 * Read the board's Konva nodes back out of the running page.
 *
 * Most of the editor is assertable through the DOM — the properties panel *is*
 * the selected object's state as markup, and that's the better thing to check
 * because it's what a planner reads. These helpers are for the two questions the
 * DOM genuinely can't answer:
 *
 *  - what happened to an object that **isn't** selected (the panel only ever
 *    shows one), and
 *  - what order things are actually **drawn** in, which is the whole observable
 *    content of z-order.
 *
 * Konva publishes every live stage on `window.Konva`, so this needs no test-only
 * hook in the app. The editor can have more than one stage (the Attacks palette
 * renders each definition as its own miniature board), so pick the real board by
 * its container rather than trusting `stages[0]`.
 */
export interface BoardNode {
  id: string;
  x: number;
  y: number;
  /** The size the object is *drawn* at, which a scale animation multiplies. */
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  /** Position in draw order among the board's identified nodes — back to front. */
  order: number;
}

const CONTAINER = '[data-testid="canvas-container"]';

export async function boardNodes(page: Page): Promise<BoardNode[]> {
  return page.evaluate((container) => {
    interface KonvaNodeLike {
      id: () => string;
      x: () => number;
      y: () => number;
      scaleX: () => number;
      scaleY: () => number;
      rotation: () => number;
      opacity: () => number;
      visible: () => boolean;
      getAttr: (name: string) => number | undefined;
    }
    interface KonvaStageLike {
      container: () => HTMLElement;
      find: (selector: string) => KonvaNodeLike[];
    }
    const konva = (
      window as unknown as { Konva?: { stages: KonvaStageLike[] } }
    ).Konva;
    const stage = konva?.stages?.find((s) => s.container().closest(container));
    if (!stage) return [];

    return stage
      .find("Group")
      .filter((node) => Boolean(node.id()))
      .map((node, order) => ({
        id: node.id(),
        x: node.x(),
        y: node.y(),
        // ObjectNode carries its authored size as `baseW`/`baseH` and leaves the
        // node's scale to the animator, so drawn size is the product of the two.
        width: (node.getAttr("baseW") ?? 0) * node.scaleX(),
        height: (node.getAttr("baseH") ?? 0) * node.scaleY(),
        rotation: node.rotation(),
        opacity: node.opacity(),
        visible: node.visible(),
        order,
      }));
  }, CONTAINER);
}

/** Every board object's id, back to front — the draw order z-order produces. */
export async function drawOrder(page: Page): Promise<string[]> {
  return (await boardNodes(page)).map((node) => node.id);
}

/** One node by id, or undefined if it isn't on the board. */
export async function boardNode(
  page: Page,
  id: string,
): Promise<BoardNode | undefined> {
  return (await boardNodes(page)).find((node) => node.id === id);
}
