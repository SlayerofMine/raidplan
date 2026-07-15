import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { loginUrl, logoutUrl, useSession } from "../api/useSession";
import { DEFAULT_BACKGROUND } from "@raidplan/shared";
import { LOCAL_PLAN_ID } from "../editor/planScope";

interface PlanSummary {
  id: string;
  title: string;
  slug: string;
  updatedAt: number;
}

/**
 * Landing page (plan §5.2's dashboard in miniature): sign in, list your plans,
 * make a new one. The offline plan is always available — you can use the editor
 * without an account at all.
 */
export function HomePage() {
  const session = useSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">RaidPlans</h1>
          <p className="text-neutral-400">
            Self-hosted World of Warcraft raid &amp; arena planner.
          </p>
        </div>
        <div className="ml-auto" data-testid="session">
          {session.status === "loading" && (
            <span className="text-sm text-neutral-500">…</span>
          )}
          {session.status === "unreachable" && (
            <button
              type="button"
              onClick={session.refresh}
              data-testid="session-retry"
              className="rounded border border-panelborder px-3 py-1 text-sm text-neutral-400 hover:border-accent"
            >
              Retry
            </button>
          )}
          {session.status === "anonymous" && (
            <a
              href={loginUrl("/")}
              data-testid="sign-in"
              className="rounded bg-accent px-4 py-2 font-medium text-neutral-950 hover:opacity-90"
            >
              Sign in with Discord
            </a>
          )}
          {session.status === "signedIn" && (
            <a
              href={logoutUrl}
              data-testid="sign-out"
              className="text-sm text-neutral-400 hover:text-accent"
            >
              Sign out
            </a>
          )}
        </div>
      </header>

      {session.status === "unreachable" && (
        <p
          data-testid="api-unreachable"
          className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          Can&apos;t reach the RaidPlans server, so signing in and saved plans
          are unavailable. The offline plan below still works.
        </p>
      )}

      {session.status === "signedIn" ? (
        <PlanList />
      ) : session.status === "anonymous" ? (
        <p className="text-sm text-neutral-500">
          Sign in with Discord to save plans and share them with your guild.
        </p>
      ) : null}

      <section className="border-t border-panelborder pt-4">
        <h2 className="text-sm font-semibold text-neutral-300">Offline plan</h2>
        <p className="mb-2 text-sm text-neutral-500">
          Kept in this browser only — no account needed.
        </p>
        <Link
          to={`/plan/${LOCAL_PLAN_ID}/edit`}
          className="text-sm text-accent hover:underline"
        >
          Open the offline editor →
        </Link>
      </section>
    </main>
  );
}

function PlanList() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.plan.list
      .query()
      .then(setPlans)
      .catch(() => setError("Could not load your plans."));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const plan = await api.plan.create.mutate({
        background: DEFAULT_BACKGROUND,
      });
      navigate(`/plan/${plan.id}/edit`);
    } catch {
      setError("Could not create a plan.");
      setCreating(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-neutral-300">Your plans</h2>
        <button
          type="button"
          onClick={create}
          disabled={creating}
          data-testid="new-plan"
          className="ml-auto rounded bg-accent px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "New plan"}
        </button>
      </div>

      {error && (
        <p data-testid="plans-error" className="text-sm text-amber-400">
          {error}
        </p>
      )}
      {!plans && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {plans?.length === 0 && (
        <p data-testid="plans-empty" className="text-sm text-neutral-500">
          No plans yet.
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="plan-list">
        {plans?.map((plan) => (
          <li key={plan.id}>
            <Link
              to={`/plan/${plan.id}/edit`}
              className="flex items-center gap-3 rounded border border-panelborder px-3 py-2 hover:border-accent"
            >
              <span className="text-neutral-100">{plan.title}</span>
              <span className="ml-auto text-xs text-neutral-500">
                /p/{plan.slug}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
