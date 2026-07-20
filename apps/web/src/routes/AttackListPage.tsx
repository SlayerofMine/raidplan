import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { RequireAdmin } from "./RequireAdmin";

/**
 * An encounter's attacks (plan §17, stage 4): the list that leads into the
 * designer. Create opens a blank designer; each row edits or deletes a def.
 */
type AttackRow = Awaited<
  ReturnType<typeof api.attack.listForEncounter.query>
>[number];

export function AttackListPage() {
  const { encounterId = "" } = useParams<{ encounterId: string }>();
  return (
    <RequireAdmin next={`/admin/encounters/${encounterId}/attacks`}>
      <AttackList encounterId={encounterId} />
    </RequireAdmin>
  );
}

function AttackList({ encounterId }: { encounterId: string }) {
  const [attacks, setAttacks] = useState<AttackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.attack.listForEncounter
      .query({ encounterId })
      .then(setAttacks)
      .catch(() => setError("Could not load attacks."));
  }, [encounterId]);
  useEffect(load, [load]);

  const remove = async (id: string) => {
    try {
      await api.attack.remove.mutate({ id });
      load();
    } catch {
      setError("Could not delete that attack.");
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Attacks</h1>
          <p className="text-sm text-neutral-400">
            Pre-designed mechanics for this encounter (plan §17).
          </p>
        </div>
        <Link
          to="/admin"
          className="ml-auto text-sm text-accent hover:underline"
        >
          ← Encounters
        </Link>
      </header>

      {error && (
        <p data-testid="attacks-error" className="text-sm text-amber-400">
          {error}
        </p>
      )}

      <Link
        to={`/admin/encounters/${encounterId}/attacks/new`}
        data-testid="new-attack"
        className="self-start rounded bg-accent px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90"
      >
        New attack
      </Link>

      {!attacks && <p className="text-sm text-neutral-500">Loading…</p>}
      {attacks?.length === 0 && (
        <p data-testid="attacks-empty" className="text-sm text-neutral-500">
          No attacks yet.
        </p>
      )}
      <ul className="flex flex-col gap-2" data-testid="attack-list">
        {attacks?.map((attack) => (
          <li
            key={attack.id}
            className="flex flex-wrap items-center gap-2 rounded border border-panelborder p-2"
          >
            <span className="flex-1 truncate text-neutral-100">
              {attack.name}
            </span>
            <span className="text-xs text-neutral-500">v{attack.version}</span>
            <Link
              to={`/admin/attacks/${attack.id}`}
              aria-label={`Edit ${attack.name}`}
              className="rounded border border-panelborder px-2 py-1 text-xs hover:border-accent"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => remove(attack.id)}
              aria-label={`Delete ${attack.name}`}
              className="rounded border border-panelborder px-2 py-1 text-xs text-amber-400 hover:border-amber-400"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
