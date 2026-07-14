import { Link } from "react-router-dom";

/**
 * Landing page. Phase 1 has no backend, so it links straight into the single
 * local editor plan. The dashboard / plan list is Phase 5.2.
 */
export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">RaidPlans</h1>
      <p className="text-neutral-300">
        Self-hosted World of Warcraft raid &amp; arena planner.
      </p>
      <Link
        to="/plan/local/edit"
        className="w-fit rounded bg-accent px-4 py-2 font-medium text-neutral-950 hover:opacity-90"
      >
        Open editor
      </Link>
    </main>
  );
}
