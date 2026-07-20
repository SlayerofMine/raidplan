import { useEditorStore } from "../store/editorStore";
import { Btn, Divider } from "./ToolbarButton";

/**
 * The object-creation controls (plan §2.4): text, the WoW mechanic shapes,
 * tethers, generic zones and arrows. Shared so the plan editor's toolbar and the
 * attack designer offer exactly the same primitives — a designer that could only
 * place icon tokens couldn't author most attacks.
 */
export function AddObjectControls() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const addTether = useEditorStore((s) => s.addTether);

  return (
    <>
      <Btn onClick={() => addPrimitive("text")} label="Text" />

      <Divider />

      {/* WoW mechanics — distinguished by form, recoloured via the tint prop. */}
      <Btn
        onClick={() => addPrimitive("shape", "cone")}
        label="Cone"
        title="Frontal (cone)"
      />
      <Btn
        onClick={() => addPrimitive("shape", "line")}
        label="Beam"
        title="Frontal (line / beam)"
      />
      <Btn
        onClick={() => addPrimitive("shape", "soak")}
        label="Soak"
        title="Soak / stack marker"
      />
      <Btn
        onClick={() => addPrimitive("shape", "voidzone")}
        label="Void"
        title="Voidzone / puddle (avoid)"
      />
      <Btn
        onClick={() => addPrimitive("shape", "pickup")}
        label="Pickup"
        title="Pickup / collectible"
      />
      <Btn
        onClick={() => {
          if (selectedIds.length === 2) {
            addTether(selectedIds[0]!, selectedIds[1]!);
          }
        }}
        disabled={selectedIds.length !== 2}
        label="Tether"
        title={
          selectedIds.length === 2
            ? "Link the two selected objects"
            : "Select exactly two objects to tether them"
        }
      />

      <Divider />

      {/* Generic zones + arrow. */}
      <Btn onClick={() => addPrimitive("shape", "rect")} label="Rect" />
      <Btn onClick={() => addPrimitive("shape", "circle")} label="Circle" />
      <Btn onClick={() => addPrimitive("arrow")} label="Arrow" />
    </>
  );
}
