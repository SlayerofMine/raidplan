/**
 * Phase 0 placeholder shell. The real editor/viewer routing and layout land in
 * Phase 1 (plan §12). This exists so `pnpm dev` renders something and the
 * deploy path (Caddy → static SPA) can be proven end to end.
 */
export function App() {
  return (
    <main style={{ padding: "2rem", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>RaidPlans</h1>
      <p>Self-hosted World of Warcraft raid &amp; arena planner.</p>
      <p>Phase 0 — foundations. The canvas editor arrives in Phase 1.</p>
    </main>
  );
}
