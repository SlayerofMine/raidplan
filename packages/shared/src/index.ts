// Public surface of @raidplan/shared — the contract imported by web and api.
export * from "./transform.js";
export * from "./effects.js";
export * from "./plan.js";
export * from "./resolve.js";
// The mechanic-shape visual language (soaks/voidzones/frontals/tethers), shared
// so the Konva editor and the server-side OG SVG draw them identically.
export * from "./mechanics.js";
// The asset manifest (plan §11): icons and bundled maps. Shared because the
// editor draws them in the browser and the API renders them server-side for
// Discord's link previews (§4.7).
export * from "./assets/svg.js";
export * from "./assets/icons.js";
export * from "./assets/backgrounds.js";
// Reusable attacks (plan §17): the reference/instance model and `expandPlan`,
// which stamps attack instances into an ordinary Plan the renderers understand.
export * from "./attack.js";
// Encounter presets (plan §17): admin-authored starting points (background +
// pre-placed objects) that seed a new plan. Shared so web offers the selector
// and api resolves the preset into a document.
export * from "./encounter.js";
// The synced WoW icon catalog contract (plan §11.1). Distinct from the bundled
// manifest above: this is the shape of the server's searchable icon feed.
export * from "./iconCatalog.js";
