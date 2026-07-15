import { CanvasStage } from "./canvas/CanvasStage";
import { IconPalette } from "./IconPalette";
import { PropertiesPanel } from "./PropertiesPanel";
import { StepStrip } from "./StepStrip";
import { Toolbar } from "./Toolbar";
import { useEditorHotkeys } from "./useEditorHotkeys";
import { useLocalPersistence } from "./useLocalPersistence";

/**
 * The five-region editor shell (plan §1.1): toolbar across the top, palette /
 * canvas / properties in the middle row, steps strip along the bottom. The grid
 * gives the canvas all remaining space while the side panels keep a fixed width.
 */
export function EditorLayout() {
  useEditorHotkeys();
  useLocalPersistence();

  return (
    <div
      className="grid h-screen w-screen overflow-hidden text-neutral-100"
      style={{
        gridTemplateColumns: "14rem 1fr 18rem",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "toolbar toolbar toolbar"
          "palette canvas  props"
          "steps   steps   steps"
        `,
      }}
    >
      <div style={{ gridArea: "toolbar" }}>
        <Toolbar />
      </div>
      <div style={{ gridArea: "palette" }} className="min-h-0">
        <IconPalette />
      </div>
      <div style={{ gridArea: "canvas" }} className="min-h-0">
        <CanvasStage />
      </div>
      <div style={{ gridArea: "props" }} className="min-h-0">
        <PropertiesPanel />
      </div>
      <div style={{ gridArea: "steps" }}>
        <StepStrip />
      </div>
    </div>
  );
}
