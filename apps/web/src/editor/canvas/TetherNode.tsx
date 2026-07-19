import { Group, Path } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useShallow } from "zustand/react/shallow";
import { tetherOps } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";
import { TETHER_DEFAULT_TINT } from "../../store/objectFactory";
import { MechArtwork } from "./MechArtwork";

/**
 * A tether (plan §2.4): a line between two *other* objects. Unlike every other
 * node it has no transform of its own — its geometry is derived from its
 * endpoints' resolved centres, so it re-fits automatically as you drag them in
 * the editor. It is not draggable or resizable (you move the endpoints); click
 * its line to select it (for recolour/delete).
 *
 * The root `Group` carries `id={objectId}` so the playback engine can fade it
 * (visible/opacity). **Known limitation:** during playback the line re-fits at
 * step boundaries, not mid-tween — following endpoints frame-by-frame would need
 * a hook into the playback tick (future work).
 */
export function TetherNode({ objectId }: { objectId: string }) {
  const object = useEditorStore((s) => s.objects[objectId]);
  const self = useEditorStore(
    useShallow((s) => selectObjectState(s, objectId)),
  );
  const from = useEditorStore(
    useShallow((s) => {
      const id = s.objects[objectId]?.fromId;
      return id ? selectObjectState(s, id) : undefined;
    }),
  );
  const to = useEditorStore(
    useShallow((s) => {
      const id = s.objects[objectId]?.toId;
      return id ? selectObjectState(s, id) : undefined;
    }),
  );
  const isSelected = useEditorStore((s) => s.selectedIds.includes(objectId));
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);

  // If either endpoint is gone or hidden, there's nothing to connect.
  if (!object || !self || !self.visible || !from || !to) return null;

  const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const tint = object.base.tint ?? TETHER_DEFAULT_TINT;
  const ops = tetherOps(fromCentre, toCentre);
  const linePath = ops.find((o) => o.t === "path")?.d;

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    if (additive) toggleSelect(objectId);
    else select([objectId]);
  };

  return (
    <Group
      id={objectId}
      opacity={self.opacity}
      onMouseDown={handleMouseDown}
      onTap={() => select([objectId])}
    >
      {/* Selection glow behind the line. */}
      {isSelected && linePath && (
        <Path
          data={linePath}
          stroke="#4f9dff"
          strokeWidth={10}
          opacity={0.4}
          listening={false}
        />
      )}
      <MechArtwork ops={ops} tint={tint} w={0} h={0} hitStrokeWidth={16} />
    </Group>
  );
}
