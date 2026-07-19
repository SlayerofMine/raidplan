import { useEffect, useMemo, type RefObject } from "react";
import { Layer, Image as KonvaImage, Stage } from "react-konva";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
import type { Stage as StageNode } from "konva/lib/Stage";
import { getBackgroundSrc } from "@raidplan/shared";
import { fitView } from "../editor/canvas/coords";
import { ObjectNode } from "../editor/canvas/ObjectNode";
import { SyncedIconResolver } from "../editor/SyncedIconResolver";
import { useContainerSize } from "../editor/canvas/useContainerSize";
import { useImageElement } from "../editor/canvas/useImageElement";
import { useEditorStore } from "../store/editorStore";

/**
 * Read-only rendering of a plan (plan §3.6). Reuses the editor's `ObjectNode`
 * so the viewer can never drift from the editor's look.
 *
 * Layers are `listening={false}` by default: nothing here is interactive, which
 * skips hit-graph work entirely (plan §8.4). Crucially, that also means React
 * never re-renders these nodes after mount, so the playback engine owns the
 * node attributes outright while a step plays (plan §8.1).
 *
 * The exception is a step containing `onClick` animations — then the object
 * layer listens so those clicks can be routed, and only then.
 */
export function ViewerStage({
  stageRef,
  clickableObjectIds = [],
  onObjectClick,
}: {
  stageRef: RefObject<StageNode>;
  /** Objects with an `onClick` animation on the current step. */
  clickableObjectIds?: string[];
  onObjectClick?: (objectId: string) => void;
}) {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();
  const background = useEditorStore((s) => s.background);
  const objectIds = useEditorStore((s) => s.objectIds);
  const bgImage = useImageElement(getBackgroundSrc(background.assetId));

  // Hit-testing costs real work, so only switch it on when this step actually
  // has something clickable (plan §8.4).
  const clickable = new Set(clickableObjectIds);
  const interactive = clickable.size > 0;

  /** Walk up from the hit shape to the node carrying a plan object's id. */
  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!onObjectClick) return;
    let node: KonvaNode | null = e.target;
    while (node) {
      const id = node.id();
      if (id && clickable.has(id)) {
        onObjectClick(id);
        return;
      }
      node = node.getParent();
    }
  };

  // The viewer has no camera of its own: always fit the plan to the container.
  const view = useMemo(() => fitView(background, size, 0), [background, size]);

  useEffect(() => {
    stageRef.current?.batchDraw();
  }, [view, stageRef]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Plan viewer"
      className="relative h-full w-full overflow-hidden bg-[#0b0d12]"
      data-testid="viewer-canvas"
    >
      {/* Fetches URLs for synced WoW tokens this plan references. */}
      <SyncedIconResolver />
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
      >
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={background.width}
              height={background.height}
            />
          )}
        </Layer>
        <Layer
          listening={interactive}
          onClick={handleClick}
          onTap={handleClick}
        >
          {objectIds.map((id) => (
            <ObjectNode key={id} objectId={id} draggable={false} />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
