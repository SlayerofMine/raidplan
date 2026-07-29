import { createContext, useContext } from "react";

/**
 * Whether the editor is being used as the **Attack Designer** (plan §21).
 *
 * A context rather than a prop threaded through six components, because almost
 * nothing needs to know: the canvas, the timeline and the player behave
 * identically either way, which is the whole reason the designer can be the
 * ordinary editor. Only the two things a definition can say that a plan cannot —
 * marking a slot, exposing a parameter — ask.
 *
 * Defaults to `false`, so every existing mount is a plan editor and stays one.
 */
export const DesignerContext = createContext(false);

export const useIsDesigner = (): boolean => useContext(DesignerContext);
