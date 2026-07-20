import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getBackgroundSrc, type Background } from "@raidplan/shared";
import { api } from "../api/client";
import { loginUrl, useSession } from "../api/useSession";
import { uploadBackground, UploadError } from "../editor/uploadBackground";

/**
 * Encounter admin (plan §17, stage 2). Authoring is server-gated by
 * `adminProcedure`; this page only *shows* the tools to admins — a non-admin who
 * reaches the route is told plainly rather than shown a panel whose every action
 * would 403.
 *
 * Backgrounds reuse the existing upload pipeline (`uploadBackground`): the admin
 * uploads their own battlemap and the encounter references the stored path, so
 * no Blizzard art is involved (plan §11).
 */
type EncounterRow = Awaited<
  ReturnType<typeof api.encounter.list.query>
>[number];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 p-8 text-center text-neutral-300">
      {children}
    </main>
  );
}

export function AdminPage() {
  const session = useSession();

  if (session.status === "loading") {
    return <Centered>…</Centered>;
  }
  if (session.status === "unreachable") {
    return <Centered>Can’t reach the RaidPlans server.</Centered>;
  }
  if (session.status === "anonymous") {
    return (
      <Centered>
        <p>Sign in to manage encounters.</p>
        <a
          href={loginUrl("/admin")}
          className="rounded bg-accent px-4 py-2 font-medium text-neutral-950 hover:opacity-90"
        >
          Sign in with Discord
        </a>
      </Centered>
    );
  }
  if (!session.session.isAdmin) {
    return (
      <Centered>
        <p data-testid="admin-forbidden">
          You’re not an admin, so encounter management isn’t available.
        </p>
        <Link to="/" className="text-accent hover:underline">
          ← Back to plans
        </Link>
      </Centered>
    );
  }
  return <AdminPanel />;
}

function AdminPanel() {
  const [encounters, setEncounters] = useState<EncounterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.encounter.list
      .query()
      .then(setEncounters)
      .catch(() => setError("Could not load encounters."));
  }, []);
  useEffect(load, [load]);

  const create = async (input: {
    name: string;
    raid: string;
    background: Background;
  }) => {
    try {
      await api.encounter.create.mutate(input);
      load();
    } catch {
      setError("Could not create the encounter.");
    }
  };

  const save = async (
    id: string,
    patch: { name?: string; raid?: string; background?: Background },
  ) => {
    try {
      await api.encounter.update.mutate({ id, ...patch });
      load();
    } catch {
      setError("Could not save that change.");
    }
  };

  const remove = async (id: string) => {
    try {
      await api.encounter.remove.mutate({ id });
      load();
    } catch {
      setError("Could not delete that encounter.");
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Encounter admin</h1>
          <p className="text-sm text-neutral-400">
            Define raids, encounters and their battlemaps (plan §17).
          </p>
        </div>
        <Link to="/" className="ml-auto text-sm text-accent hover:underline">
          ← Plans
        </Link>
      </header>

      {error && (
        <p data-testid="admin-error" className="text-sm text-amber-400">
          {error}
        </p>
      )}

      <CreateForm onCreate={create} onError={setError} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">Encounters</h2>
        {!encounters && <p className="text-sm text-neutral-500">Loading…</p>}
        {encounters?.length === 0 && (
          <p data-testid="admin-empty" className="text-sm text-neutral-500">
            No encounters yet.
          </p>
        )}
        <ul className="flex flex-col gap-2" data-testid="admin-encounter-list">
          {encounters?.map((encounter) => (
            <EncounterRow
              key={encounter.id}
              encounter={encounter}
              onSave={save}
              onRemove={remove}
              onError={setError}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}

/** Turn a picked file into a stored Background, surfacing a human error. */
async function pickBackground(
  file: File,
  onError: (message: string) => void,
): Promise<Background | null> {
  try {
    return await uploadBackground(file);
  } catch (e) {
    onError(e instanceof UploadError ? e.message : "That upload failed.");
    return null;
  }
}

const inputClass =
  "rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm";

function CreateForm({
  onCreate,
  onError,
}: {
  onCreate: (input: {
    name: string;
    raid: string;
    background: Background;
  }) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [raid, setRaid] = useState("");
  const [background, setBackground] = useState<Background | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    setBackground(await pickBackground(file, onError));
    setBusy(false);
  };

  const submit = async () => {
    if (!name.trim() || !background) return;
    await onCreate({ name: name.trim(), raid: raid.trim(), background });
    setName("");
    setRaid("");
    setBackground(null);
  };

  return (
    <section className="flex flex-col gap-3 rounded border border-panelborder p-4">
      <h2 className="text-sm font-semibold text-neutral-300">New encounter</h2>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Encounter name"
          data-testid="new-encounter-name"
          placeholder="Encounter name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <input
          aria-label="Raid"
          data-testid="new-encounter-raid"
          placeholder="Raid (optional)"
          value={raid}
          onChange={(e) => setRaid(e.target.value)}
          className={`${inputClass} flex-1`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {background ? (
          <img
            src={getBackgroundSrc(background.assetId) ?? background.assetId}
            alt=""
            className="h-12 w-20 rounded border border-panelborder object-cover"
          />
        ) : (
          <span className="text-xs text-neutral-500">No battlemap chosen</span>
        )}
        <input
          type="file"
          accept="image/*"
          aria-label="Battlemap image"
          data-testid="new-encounter-map"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
          className="text-xs text-neutral-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim() || !background}
          data-testid="create-encounter"
          className="ml-auto rounded bg-accent px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Create"}
        </button>
      </div>
    </section>
  );
}

function EncounterRow({
  encounter,
  onSave,
  onRemove,
  onError,
}: {
  encounter: EncounterRow;
  onSave: (
    id: string,
    patch: { name?: string; raid?: string; background?: Background },
  ) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(encounter.name);
  const [raid, setRaid] = useState(encounter.raid);

  const dirty =
    name.trim() !== encounter.name || raid.trim() !== encounter.raid;

  const replaceMap = async (file: File) => {
    const background = await pickBackground(file, onError);
    if (background) await onSave(encounter.id, { background });
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-panelborder p-2">
      <img
        src={
          getBackgroundSrc(encounter.background.assetId) ??
          encounter.background.assetId
        }
        alt=""
        className="h-10 w-16 rounded border border-panelborder object-cover"
      />
      <input
        aria-label={`Name of ${encounter.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputClass} flex-1`}
      />
      <input
        aria-label={`Raid of ${encounter.name}`}
        value={raid}
        onChange={(e) => setRaid(e.target.value)}
        className={`${inputClass} w-40`}
      />
      <button
        type="button"
        onClick={() =>
          onSave(encounter.id, { name: name.trim(), raid: raid.trim() })
        }
        disabled={!dirty}
        className="rounded border border-panelborder px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
      >
        Save
      </button>
      <label className="cursor-pointer rounded border border-panelborder px-2 py-1 text-xs hover:border-accent">
        Replace map
        <input
          type="file"
          accept="image/*"
          aria-label={`Replace battlemap of ${encounter.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void replaceMap(file);
          }}
          className="hidden"
        />
      </label>
      <button
        type="button"
        onClick={() => onRemove(encounter.id)}
        aria-label={`Delete ${encounter.name}`}
        className="rounded border border-panelborder px-2 py-1 text-xs text-amber-400 hover:border-amber-400"
      >
        Delete
      </button>
    </li>
  );
}
