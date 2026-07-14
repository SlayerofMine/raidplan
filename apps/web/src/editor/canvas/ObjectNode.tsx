import { Group, Image as KonvaImage, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { getIconById } from "../../assets/icons";
import { useEditorStore } from "../../store/editorStore";
import { useImageElement } from "./useImageElement";

/**
 * One plan object → one Konva node (plan §6). Subscribes to just its own slice
 * of the store so dragging one token never re-renders the other 49 (plan §8.2).
 *
 * The icon + selection outline live in a `Group` positioned at the object's
 * native `(x, y)`, so the highlight tracks the token live during a drag; on drop
 * we commit the new native coordinate back to the store.
 */
export function ObjectNode({
  objectId,
  draggable,
}: {
  objectId: string;
  draggable: boolean;
}) {
  const object = useEditorStore((s) => s.objects[objectId]);
  const isSelected = useEditorStore((s) => s.selectedId === objectId);
  const selectObject = useEditorStore((s) => s.selectObject);
  const moveObject = useEditorStore((s) => s.moveObject);
  const icon = useImageElement(
    object?.iconId ? getIconById(object.iconId)?.src : undefined,
  );

  if (!object || !object.base.visible) return null;
  const { x, y, w, h, rotation, opacity } = object.base;

  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable && !object.locked}
      onMouseDown={() => selectObject(objectId)}
      onTap={() => selectObject(objectId)}
      onDragEnd={(e: KonvaEventObject<DragEvent>) =>
        moveObject(objectId, e.target.x(), e.target.y())
      }
    >
      <KonvaImage image={icon} width={w} height={h} opacity={opacity} />
      {isSelected && (
        <Rect
          width={w}
          height={h}
          stroke="#4f9dff"
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
}
