import { useEditorStore } from "../store/editorStore";
import { Btn } from "./ToolbarButton";

/**
 * Link the two selected objects with a tether.
 *
 * This stays in the toolbar rather than the palette (plan §18.5): it isn't a
 * thing you *add* from a library, it's an operation on the current selection —
 * the tether's geometry comes from the two objects it joins. Everything you add
 * now lives in the palette's Shapes and Attacks tabs.
 */
export function TetherButton() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const addTether = useEditorStore((s) => s.addTether);
  const ready = selectedIds.length === 2;

  return (
    <Btn
      onClick={() => {
        if (ready) addTether(selectedIds[0]!, selectedIds[1]!);
      }}
      disabled={!ready}
      label="Tether"
      title={
        ready
          ? "Link the two selected objects"
          : "Select exactly two objects to tether them"
      }
    />
  );
}
