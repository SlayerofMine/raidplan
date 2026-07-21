import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";
import type { Node as KonvaNode } from "konva/lib/Node";
import type { Transformer as TransformerNode } from "konva/lib/shapes/Transformer";
import { useEditorStore } from "../../store/editorStore";

/** Rotation handles snap to 45° increments (plan §2.2). */
const ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315];
const MIN_SIZE = 8;

/**
 * Resize/rotate handles for the current selection (plan §2.2). Konva's
 * `Transformer` works imperatively on node references, so it lives outside the
 * declarative object tree: on every selection change we look the nodes up by id
 * and re-attach. Locked objects are skipped — they must not be transformable.
 */
export function SelectionTransformer() {
  const ref = useRef<TransformerNode>(null);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedAttackIds = useEditorStore((s) => s.selectedAttackIds);
  const objectIds = useEditorStore((s) => s.objectIds);

  useEffect(() => {
    const transformer = ref.current;
    const stage = transformer?.getStage();
    if (!transformer || !stage) return;

    const { objects } = useEditorStore.getState();
    const nodes = selectedIds
      // Skip locked objects and tethers — neither is resizable (a tether has no
      // transform of its own; you move its endpoints).
      .filter((id) => {
        const object = objects[id];
        return object && !object.locked && object.type !== "tether";
      })
      // A placed attack is transformed through its frame, which carries the
      // instance id (plan §18.3) — resizing it *is* resizing the rectangle.
      .concat(selectedAttackIds)
      .map((id) => stage.findOne(`#${id}`))
      .filter((node): node is KonvaNode => node !== undefined);

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
    // `objectIds` participates so the transformer re-attaches when nodes are
    // added/removed underneath a stable selection.
  }, [selectedIds, selectedAttackIds, objectIds]);

  return (
    <Transformer
      ref={ref}
      rotationSnaps={ROTATION_SNAPS}
      rotationSnapTolerance={6}
      ignoreStroke
      padding={2}
      anchorSize={8}
      borderStroke="#4f9dff"
      anchorStroke="#4f9dff"
      boundBoxFunc={(oldBox, newBox) =>
        newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox
      }
    />
  );
}
