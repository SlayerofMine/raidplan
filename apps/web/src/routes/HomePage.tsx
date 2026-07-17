import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { loginUrl, logoutUrl, useSession } from "../api/useSession";
import {
  BACKGROUNDS,
  DEFAULT_BACKGROUND,
  toBackground,
} from "@raidplan/shared";
import { LOCAL_PLAN_ID } from "../editor/planScope";
import { filterPlans, planRaids, relativeTime } from "./planFilters";

/** One row of `plan.list`, with every field the server sends. */
type PlanRow = Awaited<ReturnType<typeof api.plan.list.query>>[number];

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

/** Placeholder cards shown while the plan list loads (plan §5.4). */
function PlanListSkeleton() {
  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="plans-loading"
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="overflow-hidden rounded border border-panelborder"
        >
          <div className="aspect-[1200/630] w-full animate-pulse bg-neutral-800" />
          <div className="m-3 h-4 w-2/3 animate-pulse rounded bg-neutral-800" />
        </li>
      ))}
    </ul>
  );
}

function PlanList() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [raid, setRaid] = useState("");
  const [startMap, setStartMap] = useState(DEFAULT_BACKGROUND.assetId);

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
      // A "starter": begin on the chosen bundled map (plan §5.2).
      const def = BACKGROUNDS.find((b) => b.assetId === startMap);
      const plan = await api.plan.create.mutate({
        background: def ? toBackground(def) : DEFAULT_BACKGROUND,
      });
      navigate(`/plan/${plan.id}/edit`);
    } catch {
      setError("Could not create a plan.");
      setCreating(false);
    }
  };

  const duplicate = async (id: string) => {
    try {
      await api.plan.duplicate.mutate({ id });
      load(); // the copy appears without a page refresh
    } catch {
      setError("Could not duplicate that plan.");
    }
  };

  const raids = plans ? planRaids(plans) : [];
  const visible = plans ? filterPlans(plans, { query, raid }) : [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">Your plans</h2>
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="start-map">
            Starting map
          </label>
          <select
            id="start-map"
            aria-label="Starting map for a new plan"
            data-testid="start-map"
            value={startMap}
            onChange={(e) => setStartMap(e.target.value)}
            className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
          >
            {BACKGROUNDS.map((b) => (
              <option key={b.assetId} value={b.assetId}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            data-testid="new-plan"
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "New plan"}
          </button>
        </div>
      </div>

      {plans && plans.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            placeholder="Search plans…"
            aria-label="Search plans"
            data-testid="plan-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-40 flex-1 rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
          />
          {raids.length > 0 && (
            <select
              aria-label="Filter by raid"
              data-testid="raid-filter"
              value={raid}
              onChange={(e) => setRaid(e.target.value)}
              className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
            >
              <option value="">All raids</option>
              {raids.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <p data-testid="plans-error" className="text-sm text-amber-400">
          {error}
        </p>
      )}
      {!plans && !error && <PlanListSkeleton />}
      {plans?.length === 0 && (
        <p data-testid="plans-empty" className="text-sm text-neutral-500">
          No plans yet.
        </p>
      )}
      {plans && plans.length > 0 && visible.length === 0 && (
        <p data-testid="plans-no-match" className="text-sm text-neutral-500">
          No plans match your search.
        </p>
      )}

      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="plan-list"
      >
        {visible.map((plan) => (
          <li
            key={plan.id}
            className="flex flex-col overflow-hidden rounded border border-panelborder"
          >
            <Link
              to={`/plan/${plan.id}/edit`}
              className="flex flex-col hover:opacity-90"
            >
              <img
                // The OG renderer doubles as a live thumbnail (plan §4.7/§5.2);
                // decorative, so the link's name stays just the title.
                src={`/p/${plan.slug}/og.png`}
                alt=""
                loading="lazy"
                data-testid="plan-thumb"
                className="aspect-[1200/630] w-full bg-neutral-900 object-cover"
              />
              <span className="truncate px-3 pt-2 text-neutral-100">
                {plan.title}
              </span>
            </Link>
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-1 text-xs text-neutral-500">
              {plan.raid && (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  {plan.raid}
                </span>
              )}
              <span className="capitalize">{plan.visibility}</span>
              <span>· {relativeTime(plan.updatedAt)}</span>
              <button
                type="button"
                onClick={() => duplicate(plan.id)}
                aria-label={`Duplicate ${plan.title}`}
                className="ml-auto rounded border border-panelborder px-1.5 py-0.5 hover:border-accent"
              >
                Duplicate
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
