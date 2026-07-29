// Public surface of @raidplan/shared — the contract imported by web and api.
export * from "./transform.js";
// Following: an origin pinned to one object and a direction aimed at another
// (plan §18.17). One solver, for any object on the board.
export * from "./follow.js";
export * from "./effects.js";
// Attacks (plan §21): the parameters, bindings, placement transform and
// instance recipe. The definition itself lives in `plan.js` with the document
// schemas it is mutually recursive with.
export * from "./attack.js";
export * from "./plan.js";
// How a placement moves an attack's authored geometry, and the derivation of a
// placement into ordinary objects and animations (plan §21). Pure, so the
// editor, the designer's lint and the tests all agree about where an attack
// lands.
export * from "./attackTransform.js";
export * from "./attackStamp.js";
export * from "./resolve.js";
// The route a `move` follows (plan §7). Pure geometry, so the editor overlay,
// the player, the frame exporter and the server-side SVG all draw one curve.
export * from "./motionPath.js";
// When each animation of a slide runs (plan §7). Document-level, so the player,
// the Gantt and `expandPlan` can never disagree about where a bar sits.
export * from "./timeline.js";
// The mechanic-shape visual language (soaks/voidzones/frontals/tethers), shared
// so the Konva editor and the server-side OG SVG draw them identically.
export * from "./mechanics.js";
// The asset manifest (plan §11): icons and bundled maps. Shared because the
// editor draws them in the browser and the API renders them server-side for
// Discord's link previews (§4.7).
export * from "./assets/svg.js";
export * from "./assets/icons.js";
export * from "./assets/backgrounds.js";
// Encounter presets (plan §17): admin-authored starting points (background +
// pre-placed objects) that seed a new plan. Shared so web offers the selector
// and api resolves the preset into a document.
export * from "./encounter.js";
// The synced WoW icon catalog contract (plan §11.1). Distinct from the bundled
// manifest above: this is the shape of the server's searchable icon feed.
export * from "./iconCatalog.js";
