import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./routes/HomePage";
import { ToastProvider } from "./ui/toast";

// The editor (Konva + GSAP later) is the heavy part of the bundle — code-split
// it so the landing page loads lean and tests never pull the canvas stack.
const EditorPage = lazy(() =>
  import("./routes/EditorPage").then((m) => ({ default: m.EditorPage })),
);
const ViewerPage = lazy(() =>
  import("./routes/ViewerPage").then((m) => ({ default: m.ViewerPage })),
);
const AdminPage = lazy(() =>
  import("./routes/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const AttackListPage = lazy(() =>
  import("./routes/AttackListPage").then((m) => ({
    default: m.AttackListPage,
  })),
);
const AttackDesignerPage = lazy(() =>
  import("./routes/AttackDesignerPage").then((m) => ({
    default: m.AttackDesignerPage,
  })),
);

/**
 * App routes (plan §3): landing, the editor, and the public viewer `/p/:slug`
 * (served from the local plan until Phase 4.6 adds sharing). Unknown paths fall
 * back to the landing page.
 */
export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Suspense
          fallback={<div className="p-8 text-neutral-400">Loading editor…</div>}
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/plan/:id/edit" element={<EditorPage />} />
            {/*
            The viewer lives at /view/:slug, not /p/:slug: `/p/*` is the public
            *share link*, served by the API so Discord's crawler gets real Open
            Graph meta (it doesn't run JS, so the SPA shell would unfurl as
            nothing). Caddy proxies /p/* to the API in production; that page
            then hands humans on to this route.
          */}
            <Route path="/view/:slug" element={<ViewerPage />} />
            {/* Admin-gated on the server; the pages turn non-admins away too. */}
            <Route path="/admin" element={<AdminPage />} />
            <Route
              path="/admin/encounters/:encounterId/attacks"
              element={<AttackListPage />}
            />
            <Route
              path="/admin/encounters/:encounterId/attacks/new"
              element={<AttackDesignerPage />}
            />
            <Route
              path="/admin/attacks/:attackId"
              element={<AttackDesignerPage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}
