import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";
import type { Node as KonvaNode } from "konva/lib/Node";
import type { Transformer as TransformerNode } from "konva/lib/shapes/Transformer";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";
import { carryBox, MIN_OBJECT_SIZE } from "./coords";

/** Rotation handles snap to 45° increments (plan §2.2). */
const ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Resize/rotate handles for the current selection (plan §2.2). Konva's
 * `Transformer` works imperatively on node references, so it lives outside the
 * declarative object tree: on every selection change we look the nodes up by id
 * and re-attach. Locked objects are skipped — they must not be transformable.
 *
 * Everything it needs arrives as **props**, deliberately, and subscribing to the
 * store here instead is a bug: `CanvasStage` is what turns the document into
 * Konva nodes, so a component that hears about a change *before* `CanvasStage`
 * re-renders will look for a node that does not exist yet. A second subscriber
 * inside the stage does exactly that — react-konva renders the stage's children
 * through its own reconciler, driven from `CanvasStage`'s commit, while a
 * `useSyncExternalStore` subscription re-renders this component the moment the
 * store is written. Adding an object writes the object and selects it in one
 * go, so that early pass saw the new id and an empty layer, attached the
 * transformer to nothing, and — its dependencies now satisfied — never ran
 * again: a freshly added object came up selected with no handles round it.
 *
 * Taking the same values as props puts this back in `CanvasStage`'s render, so
 * the nodes are created in the commit whose effects then attach to them.
 */
export function SelectionTransformer({
  selectedIds,
  objectIds,
  selectionSizes,
}: {
  selectedIds: readonly string[];
  /** Not read — a dependency, so added or removed nodes force a re-attach. */
  objectIds: readonly string[];
  /** Not read — a dependency; see `selectSelectionSizes` and the effect below. */
  selectionSizes: string;
}) {
  const ref = useRef<TransformerNode>(null);

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
      .map((id) => stage.findOne(`#${id}`))
      // Hidden objects keep their nodes so playback can reveal them, but they
      // can't be clicked or dragged — handles floating over nothing would be a
      // lie about what you can grab.
      .filter(
        (node): node is KonvaNode => node !== undefined && node.isVisible(),
      );

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
    // `objectIds` participates so the transformer re-attaches when nodes are
    // added/removed underneath a stable selection.
  }, [selectedIds, objectIds]);

  /**
   * Re-measure when a selected object changes size, because nothing else will:
   * the size lives on the children of its `Group`, and Konva only watches the
   * attached node's own `width`/`height` (see `selectSelectionSizes`).
   *
   * An effect, so it runs after the commit that resized those children — doing
   * it inside `onTransformEnd` would measure them at their old size, which is
   * the bug. Second, so a selection change has already attached the nodes this
   * refreshes.
   */
  useEffect(() => {
    const transformer = ref.current;
    if (!transformer || transformer.nodes().length === 0) return;
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [selectionSizes]);

  /**
   * Settle a transform of **several** objects — the whole selection, in one
   * action (plan §18.1).
   *
   * Two things make this the right place rather than the object nodes. It is
   * one undo: each node settling itself left an entry per member, so taking a
   * turn back meant pressing undo three times and watching the group come apart
   * a piece at a time. And it is the only place that can see the members the
   * handles never reached — a hidden object keeps its node so playback can
   * reveal it, but is deliberately never attached here, and one left behind
   * while the rest of its group turned would be out of place the moment the
   * slide that shows it played. The nodes that *were* moved say what happened:
   * one of them, read against the state it had before, gives the transform to
   * carry the others by.
   *
   * All of which works because this fires **before** the nodes' own
   * `transformend` (Konva's `Transformer._removeEvents` fires its own first),
   * so the store still holds the pre-gesture document while the nodes already
   * carry their final placement — including the scale each one folds away into
   * `w`/`h` a moment later.
   *
   * A lone object settles itself, in `ObjectNode`: it alone turns about its own
   * origin rather than the selection's centre, which is a correction only it can
   * make (see `pivotCorrection`).
   */
  const settleSelection = () => {
    const store = useEditorStore.getState();
    if (store.selectedIds.length < 2) return;

    const held = ref.current?.nodes() ?? [];
    // Where each node the handles moved has ended up.
    const settled = held.flatMap((node) => {
      const before = selectObjectState(store, node.id());
      if (!before) return [];
      return [
        {
          id: node.id(),
          x: node.x(),
          y: node.y(),
          w: before.w * node.scaleX(),
          h: before.h * node.scaleY(),
          rotation: node.rotation(),
          before,
        },
      ];
    });
    const reference = settled[0];
    if (!reference) return;

    const holding = new Set(settled.map((box) => box.id));
    const carried = store.selectedIds.flatMap((id) => {
      if (holding.has(id)) return [];
      const box = selectObjectState(store, id);
      return box ? [{ id, ...carryBox(box, reference.before, reference) }] : [];
    });

    store.applyTransforms([...settled, ...carried]);
  };

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
      onTransformEnd={settleSelection}
      boundBoxFunc={(oldBox, newBox) =>
        newBox.width < MIN_OBJECT_SIZE || newBox.height < MIN_OBJECT_SIZE
          ? oldBox
          : newBox
      }
    />
  );
}
