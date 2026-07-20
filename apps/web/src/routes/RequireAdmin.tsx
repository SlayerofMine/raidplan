import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { loginUrl, useSession } from "../api/useSession";

/** Centered, muted message frame for the admin gate's non-authoring states. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 p-8 text-center text-neutral-300">
      {children}
    </main>
  );
}

/**
 * Gate an admin page (plan §17). Authoring is server-enforced by
 * `adminProcedure`; this only decides what to *show* — a non-admin is told
 * plainly rather than shown tools whose every action would 403. `next` is where
 * to return after a sign-in.
 */
export function RequireAdmin({
  next,
  children,
}: {
  next: string;
  children: ReactNode;
}) {
  const session = useSession();

  if (session.status === "loading") return <Centered>…</Centered>;
  if (session.status === "unreachable") {
    return <Centered>Can’t reach the RaidPlans server.</Centered>;
  }
  if (session.status === "anonymous") {
    return (
      <Centered>
        <p>Sign in to manage encounters.</p>
        <a
          href={loginUrl(next)}
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
          You’re not an admin, so this isn’t available.
        </p>
        <Link to="/" className="text-accent hover:underline">
          ← Back to plans
        </Link>
      </Centered>
    );
  }
  return <>{children}</>;
}
